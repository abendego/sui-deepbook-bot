// @ts-nocheck
import { Transaction } from "@mysten/sui/transactions";
import { getEnv } from "../env.js";
import { log } from "../logger.js";
import { DeepBookBot } from "../deepbookBot.js";

async function tryCall(fn: any, label: string, args: any[]) {
  try {
    const r = fn(...args);
    return { ok: true, label, ret: r };
  } catch (e: any) {
    return { ok: false, label, err: e?.message ?? String(e) };
  }
}

async function main() {
  const env: any = getEnv();
  if (!env.POOL_KEY) throw new Error("Missing POOL_KEY");
  if (!env.BALANCE_MANAGER_ID) throw new Error("Missing BALANCE_MANAGER_ID");
  if (!env.SUI_PRIVATE_KEY) throw new Error("Missing SUI_PRIVATE_KEY");

  const balanceManagerKey = String(env.BALANCE_MANAGER_KEY ?? "BM1").trim();
  const managerId = String(env.BALANCE_MANAGER_ID).trim();

  const bot = new DeepBookBot(env.SUI_PRIVATE_KEY, env.SUI_ENV, {
    balanceManagers: { [balanceManagerKey]: { address: managerId } },
  });

  const db: any = bot.dbClient;

  // ✅ registerPool exists on dbClient (you saw it in the method list)
  if (typeof db.registerPool !== "function") {
    throw new Error(
      `dbClient.registerPool not found. Available dbClient keys:\n${Object.keys(db).sort().join(", ")}`
    );
  }

  log.warn(
    { poolKey: env.POOL_KEY, balanceManagerKey, managerId, registerPool_len: db.registerPool.length },
    "Registering pool for balance manager (one-time)"
  );

  const txb = new Transaction();

  // Try likely tx-builder signatures
  const attempts: Array<[string, any[]]> = [
    ["(txb, poolKey, balanceManagerKey)", [txb, env.POOL_KEY, balanceManagerKey]],
    ["(txb, poolKey, managerId)", [txb, env.POOL_KEY, managerId]],
    ["(txb, poolKey)", [txb, env.POOL_KEY]],
    ["(txb, poolKey, balanceManagerKey, managerId)", [txb, env.POOL_KEY, balanceManagerKey, managerId]],
  ];

  let built = false;
  const errs: any[] = [];

  for (const [label, args] of attempts) {
    const res = await tryCall(db.registerPool.bind(db), label, args);
    if (res.ok) {
      // If it returns a function (curried), apply it
      if (typeof res.ret === "function") res.ret(txb);
      log.info({ used: label, retType: typeof res.ret }, "registerPool builder applied");
      built = true;
      break;
    } else {
      errs.push(res);
    }
  }

  if (!built) {
    log.error({ errs }, "Could not build registerPool tx with any signature");
    throw new Error("registerPool build failed");
  }

  const exec = await bot.suiClient.signAndExecuteTransaction({
    signer: bot.keypair,
    transaction: txb,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  });

  const err = exec.effects?.status?.error;
  if (err) log.error({ err: String(err) }, "❌ registerPool tx failed");

  log.info({ digest: exec.digest, status: exec.effects?.status?.status }, "registerPool tx result");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
