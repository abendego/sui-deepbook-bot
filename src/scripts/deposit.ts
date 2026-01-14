// src/scripts/deposit.ts
import { Transaction } from "@mysten/sui/transactions";
import { getEnv } from "../env.js";
import { log } from "../logger.js";
import { DeepBookBot } from "../deepbookBot.js";
import { callSdkHelper } from "./_sdkCall.js";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const env: any = getEnv();
  const bot = new DeepBookBot(env.SUI_PRIVATE_KEY, env.SUI_ENV);

  if (!env.BALANCE_MANAGER_ID) {
    throw new Error("Missing BALANCE_MANAGER_ID in .env");
  }

  const owner = bot.getActiveAddress();

  log.info(
    { owner, bm: env.BALANCE_MANAGER_ID, network: env.SUI_ENV },
    "Depositing into BalanceManager"
  );

  // Sanity: do we have gas?
  const gas = await bot.suiClient.getCoins({ owner });
  if (!gas.data?.length) throw new Error("No SUI coins found for gas. Use faucet.");

  // Build a tx so we can guarantee we get digest/objectChanges when possible
  const txb = new Transaction();

  // Deposit SUI (tiny)
  // The SDK method exists: balanceManager.depositIntoManager (we discovered it in your inspect output)
  // We’ll try common argument patterns safely via callSdkHelper.
  const depositIntoManager = (bot.dbClient as any).balanceManager.depositIntoManager;

  // Many SDKs accept: (txb, balanceManagerId, coinSymbolOrType, amount)
  // We'll try coin symbols "SUI" and "DBUSDC" first (common in DeepBook TS SDK).
  await callSdkHelper(depositIntoManager, txb, env.BALANCE_MANAGER_ID, "SUI", env.DEPOSIT_SUI);
  await callSdkHelper(depositIntoManager, txb, env.BALANCE_MANAGER_ID, "DBUSDC", env.DEPOSIT_DBUSDC);

  log.info("Built deposit tx. Executing...");

  const res = await bot.suiClient.signAndExecuteTransaction({
    signer: bot.keypair,
    transaction: txb,
    options: { showEffects: true, showObjectChanges: true, showBalanceChanges: true },
  });

  log.info({ digest: res.digest }, "✅ Deposits executed");

  // Optional: check manager balances if the SDK supports it
  const check = (bot.dbClient as any).balanceManager.checkManagerBalance;
  if (typeof check === "function") {
    await sleep(1000);
    try {
      const balances = await check(env.BALANCE_MANAGER_ID);
      log.info({ balances }, "BalanceManager balances");
    } catch (e) {
      log.warn({ err: e }, "Could not read manager balances (ok for now).");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
