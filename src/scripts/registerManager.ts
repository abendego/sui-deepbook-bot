import { Transaction } from "@mysten/sui/transactions";
import { getEnv } from "../env.js";
import { log } from "../logger.js";
import { DeepBookBot } from "../deepbookBot.js";

function findMethod(obj: any, patterns: RegExp[]) {
  const names = new Set<string>();

  for (const n of Object.getOwnPropertyNames(obj ?? {})) {
    if (typeof (obj as any)[n] === "function") names.add(n);
  }

  const proto = Object.getPrototypeOf(obj);
  if (proto) {
    for (const n of Object.getOwnPropertyNames(proto)) {
      if (typeof (obj as any)[n] === "function") names.add(n);
    }
  }

  const list = Array.from(names).sort();
  const hit = list.find((n) => patterns.every((p) => p.test(n)));
  return { hit, names: list };
}

async function tryCall(fn: Function, label: string, args: any[]) {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    await fn(...args);
    return { ok: true as const, label };
  } catch (e: any) {
    return { ok: false as const, label, err: e?.message ?? String(e) };
  }
}

async function main() {
  const env: any = getEnv();

  const managerKey = env.BALANCE_MANAGER_KEY ?? "BM1";
  const bmObjectId = env.BALANCE_MANAGER_ID;

  if (!bmObjectId) {
    throw new Error("Missing BALANCE_MANAGER_ID in .env (object id like 0xabc...)");
  }

  const bot = new DeepBookBot(env.SUI_PRIVATE_KEY, env.SUI_ENV);
  const ownerAddress = bot.getActiveAddress();

  // In deepbook-v3 this helper usually lives on dbClient.balanceManager
  const bm = (bot.dbClient as any).balanceManager;
  if (!bm) {
    const keys = Object.keys(bot.dbClient as any);
    throw new Error(
      `dbClient.balanceManager is missing. Available dbClient keys:\n${keys.join("\n")}`
    );
  }

  const { hit, names } = findMethod(bm, [/register/i, /balance/i, /manager/i]);
  if (!hit) {
    throw new Error(
      `Could not find a registerBalanceManager method. Available balanceManager methods:\n${names.join(
        "\n"
      )}`
    );
  }

  log.warn(
    { ownerAddress, managerKey, bmObjectId, method: hit },
    "Registering BalanceManager mapping (key -> objectId)"
  );

  const txb = new Transaction();
  const fn = bm[hit].bind(bm);

  // Different SDK builds have slightly different arg orders — try common ones
  const attempts: Array<[string, any[]]> = [
    ["txb,owner,managerKey,bmObjectId", [txb, ownerAddress, managerKey, bmObjectId]],
    ["txb,managerKey,bmObjectId", [txb, managerKey, bmObjectId]],
    ["txb,bmObjectId,managerKey", [txb, bmObjectId, managerKey]],
    ["txb,owner,bmObjectId,managerKey", [txb, ownerAddress, bmObjectId, managerKey]],
  ];

  const errors: any[] = [];
  let built = false;

  for (const [label, args] of attempts) {
    const res = await tryCall(fn, label, args);
    if (res.ok) {
      built = true;
      log.info({ usedSignature: label }, "✅ Built registerBalanceManager tx");
      break;
    }
    errors.push({ label, err: res.err });
  }

  if (!built) {
    log.error({ errors }, "All registerBalanceManager signatures failed");
    throw new Error("Could not build registerBalanceManager tx (see errors).");
  }

  const exec = await bot.suiClient.signAndExecuteTransaction({
    signer: bot.keypair,
    transaction: txb,
    options: { showEffects: true, showObjectChanges: true },
  });

  log.info({ digest: exec.digest }, "✅ Registered BalanceManager");
  log.info(
    { managerKey, bmObjectId },
    "Done. (No SDK verification step here — avoids deepBook undefined crash.)"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
