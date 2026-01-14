import { getEnv } from "../env.js";
import { log } from "../logger.js";
import { DeepBookBot } from "../deepbookBot.js";
import { Transaction } from "@mysten/sui/transactions";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractBalanceManagerId(res: any): string | null {
  const changes: any[] = res?.objectChanges ?? [];
  const hit = changes.find((c) => {
    const t = (c.objectType ?? "").toLowerCase();
    return t.includes("balance") && t.includes("manager");
  });
  return hit?.objectId ?? hit?.objectRef?.objectId ?? null;
}

async function main() {
  const env = getEnv();
  const bot = new DeepBookBot(env.SUI_PRIVATE_KEY, env.SUI_ENV);
  const owner = bot.getActiveAddress();

  log.info({ owner, network: env.SUI_ENV }, "Creating BalanceManager (build + execute)");

  const txb = new Transaction();

  const fn: any = bot.dbClient.balanceManager.createAndShareBalanceManager;

  // Debug: what shape is this function?
  log.info(
    { fnType: typeof fn, arity: typeof fn === "function" ? fn.length : null },
    "BM helper signature"
  );

  // Handle both SDK shapes:
  // 1) fn(txb)
  // 2) build = fn(); build(txb)
  let built = false;

  try {
    if (typeof fn === "function" && fn.length >= 1) {
      await fn(txb);
      built = true;
    } else if (typeof fn === "function") {
      const maybeBuilder = await fn();
      if (typeof maybeBuilder === "function") {
        await maybeBuilder(txb);
        built = true;
      }
    }
  } catch (e) {
    log.warn({ err: e }, "BM helper call failed in primary path, trying fallback...");
  }

  // Fallback: even if fn.length says 0, some libs still accept txb
  if (!built) {
    await fn(txb);
    built = true;
  }

  log.info("Built transaction. Executing...");

  const res = await bot.suiClient.signAndExecuteTransaction({
    signer: bot.keypair,
    transaction: txb,
    options: {
      showEffects: true,
      showObjectChanges: true,
      showInput: true,
      showBalanceChanges: true,
    },
  });

  log.info({ digest: res.digest }, "✅ Executed BalanceManager creation tx");

  const bmId = extractBalanceManagerId(res);
  if (bmId) {
    log.info({ bmId }, "🎉 BalanceManager objectId");
    log.info(`Set BALANCE_MANAGER_ID=${bmId} in your .env`);
    return;
  }

  // If our filter missed it, print objectTypes so we can pick the right one
  const types = (res.objectChanges ?? [])
    .map((c: any) => ({ type: c.type, objectType: c.objectType, objectId: c.objectId }))
    .filter((x: any) => x.objectType);

  log.warn({ objectChangeTypes: types }, "No BM match — inspect object types above");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
