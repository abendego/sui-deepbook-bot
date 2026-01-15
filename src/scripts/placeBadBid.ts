// @ts-nocheck
import { Transaction } from "@mysten/sui/transactions";
import { getEnv } from "../env.js";
import { log } from "../logger.js";
import { DeepBookBot } from "../deepbookBot.js";

function requireTrading(env: any) {
  if (!env.ALLOW_TRADING)
    throw new Error("Trading disabled. Set ALLOW_TRADING=true in .env");
}

function normalizeOpenOrders(openRaw: any): any[] {
  if (Array.isArray(openRaw)) return openRaw;
  if (Array.isArray(openRaw?.open)) return openRaw.open;
  if (Array.isArray(openRaw?.orders)) return openRaw.orders;
  if (Array.isArray(openRaw?.data)) return openRaw.data;
  return [];
}

function u64ClientOrderId(): string {
  return String(Date.now());
}

/**
 * Resolve env.POOL_KEY into the actual pool object address.
 * - If POOL_KEY already looks like 0x..., keep it.
 * - If POOL_KEY is a named constant (ex: SUI_DBUSDC), map it based on network.
 *
 * NOTE: This mapping comes straight from @mysten/deepbook-v3 constants.ts.
 * You can expand it later, but this unblocks you now.
 */
function resolvePoolRef(env: any): string {
  const raw = String(env.POOL_KEY ?? "").trim();
  if (!raw) throw new Error("Missing POOL_KEY in .env");

  // already a pool object address
  if (raw.startsWith("0x")) return raw;

  const network = String(env.SUI_ENV ?? "").toLowerCase();
  const isTestnet =
    network.includes("test") || network.includes("dev") || network.includes("local");

  const TESTNET_POOLS: Record<string, string> = {
    // testnetPools.SUI_DBUSDC.address
    SUI_DBUSDC:
      "0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5",
    // add more if you want:
    // DEEP_SUI: "0x48c95963e9eac37a316b7ae04a0deb761bcdcc2b67912374d6036e7f0e9bae9f",
  };

  const MAINNET_POOLS: Record<string, string> = {
    // example if you ever switch:
    // SUI_USDC: "0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407",
  };

  const map = isTestnet ? TESTNET_POOLS : MAINNET_POOLS;
  const resolved = map[raw];

  if (!resolved) {
    throw new Error(
      `POOL_KEY "${raw}" not found in ${isTestnet ? "TESTNET" : "MAINNET"} mapping. ` +
        `Either set POOL_KEY to the 0x pool address directly, or add it to resolvePoolRef().`
    );
  }

  return resolved;
}

/**
 * Robust tx execution helper because different repos wire the signer/client differently.
 */
async function signAndExecuteAny(bot: any, txb: Transaction) {
  const opts = {
    showEffects: true,
    showEvents: true,
    showInput: true,
  };

  // Common patterns we try in order.
  const candidates: Array<() => Promise<any>> = [
    // Newer Sui SDK pattern: client.signAndExecuteTransaction({ signer, transaction, options })
    async () => {
      if (!bot?.client?.signAndExecuteTransaction) throw new Error("no bot.client.signAndExecuteTransaction");
      const signer = bot.signer ?? bot.keypair ?? bot.wallet ?? bot.account;
      if (!signer) throw new Error("no signer on bot (signer/keypair/wallet/account)");
      return bot.client.signAndExecuteTransaction({ signer, transaction: txb, options: opts });
    },

    async () => {
      if (!bot?.suiClient?.signAndExecuteTransaction) throw new Error("no bot.suiClient.signAndExecuteTransaction");
      const signer = bot.signer ?? bot.keypair ?? bot.wallet ?? bot.account;
      if (!signer) throw new Error("no signer on bot (signer/keypair/wallet/account)");
      return bot.suiClient.signAndExecuteTransaction({ signer, transaction: txb, options: opts });
    },

    // Older-ish pattern in some wrappers
    async () => {
      if (!bot?.signAndExecuteTransaction) throw new Error("no bot.signAndExecuteTransaction");
      return bot.signAndExecuteTransaction(txb, opts);
    },

    async () => {
      if (!bot?.signAndExecute) throw new Error("no bot.signAndExecute");
      return bot.signAndExecute(txb);
    },
  ];

  let lastErr: any = null;
  for (const fn of candidates) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
    }
  }

  throw new Error(
    `Could not execute tx (no compatible signAndExecute method found). Last error: ${lastErr?.message ?? String(lastErr)}`
  );
}

async function main() {
  const env: any = getEnv();
  requireTrading(env);

  const balanceManagerKey = String(env.BALANCE_MANAGER_KEY ?? "BM1").trim();
  const managerId = String(env.BALANCE_MANAGER_ID ?? "").trim();
  if (!managerId) throw new Error("Missing BALANCE_MANAGER_ID (0x...)");

  // Resolve pool key -> pool object address
  const poolRef = resolvePoolRef(env);

  const bot = new DeepBookBot(env.SUI_PRIVATE_KEY, env.SUI_ENV, {
    balanceManagers: { [balanceManagerKey]: { address: managerId } },
  });

  const deep = (bot.dbClient as any).deepBook;
  const bm = (bot.dbClient as any).balanceManager;
  if (!deep) throw new Error("dbClient.deepBook missing");
  if (!bm) throw new Error("dbClient.balanceManager missing");

  // Debug shapes (keep these while we’re wiring)
  log.info(
    {
      POOL_KEY: env.POOL_KEY,
      poolRef,
      deep_midPrice_len: deep.midPrice?.length,
      deep_getLevel2Range_len: deep.getLevel2Range?.length,
      deep_placeLimitOrder_len: deep.placeLimitOrder?.length,
      deep_account_len: deep.account?.length,
      bm_generateProofAsTrader_len: bm.generateProofAsTrader?.length,
    },
    "Method shapes"
  );

  // Read market price safely
  let mid: number | null = null;
  try {
    const raw = await deep.midPrice(poolRef);
    console.log("midPrice raw", raw);
    mid = Number(raw);
  } catch (e: any) {
    log.warn({ err: e?.message ?? String(e) }, "midPrice() failed; falling back to L2");
  }

  if (!mid || Number.isNaN(mid) || mid <= 0) {
    // fallback to L2 best bid/ask range
    const l2 = await deep.getLevel2Range(poolRef, 0.1, 10, true);
    console.log("L2 raw", l2);

    const bestBid = Number(l2?.prices?.[0]);
    if (!bestBid || Number.isNaN(bestBid)) {
      throw new Error("Could not read best bid/ask (book may be empty, or poolRef wrong).");
    }
    mid = bestBid; // good enough for our bad-bid calc
  }

  const mult = Number(env.BAD_BID_MULT ?? 0.2);
  if (!(mult > 0 && mult < 1)) throw new Error("BAD_BID_MULT must be between 0 and 1.");

  const price = mid * mult;

  const maxUsd = Number(env.MAX_ORDER_USD ?? 50);
  const quantity = Math.max(0.01, maxUsd / price);

  const clientOrderId = env.CLIENT_ORDER_ID ? String(env.CLIENT_ORDER_ID) : u64ClientOrderId();

  log.warn(
    { POOL_KEY: env.POOL_KEY, poolRef, balanceManagerKey, mid, price, quantity, clientOrderId },
    "Placing BAD BID (resolved poolRef)"
  );

  const txb = new Transaction();

  // 1) generate proof as trader (this is required in current DeepBook versions)
  try {
    // bm.generateProofAsTrader_len was 2 in your inspect → likely (txb, balanceManagerKey)
    if (bm.generateProofAsTrader?.length >= 2) bm.generateProofAsTrader(txb, balanceManagerKey);
    else bm.generateProofAsTrader(txb);
  } catch (e: any) {
    log.warn(
      { err: e?.message ?? String(e) },
      "balanceManager.generateProofAsTrader(...) failed; order may fail without proof"
    );
  }

  // 2) account() in same tx to prep trade proof / account state
  try {
    // common signatures: (txb, poolKey, balanceManagerKey) or (txb, balanceManagerKey)
    if (deep.account?.length >= 3) deep.account(txb, poolRef, balanceManagerKey);
    else if (deep.account?.length >= 2) deep.account(txb, balanceManagerKey);
    else deep.account(txb);
  } catch (e: any) {
    log.warn(
      { err: e?.message ?? String(e) },
      "deep.account(...) failed; continuing (but order may fail)"
    );
  }

  // 3) place limit order (builder pattern)
  const builder = deep.placeLimitOrder({
    poolKey: poolRef, // IMPORTANT: pool object address
    balanceManagerKey,
    clientOrderId,
    isBid: true,
    price,
    quantity,
    payWithDeep: true,
  });

  if (typeof builder !== "function") {
    throw new Error("deep.placeLimitOrder(...) did not return a builder function");
  }
  builder(txb);

  // 4) execute
  const exec = await signAndExecuteAny(bot, txb);

  log.info(
    {
      digest: exec.digest,
      status: exec.effects?.status?.status,
      error: exec.effects?.status?.error,
      eventCount: (exec.events ?? []).length,
    },
    "Order tx result"
  );

  // Verify open orders
  const openRaw = await deep.accountOpenOrders(poolRef, balanceManagerKey);
  const open = normalizeOpenOrders(openRaw);
  log.info({ openCount: open.length, open }, "Open orders (by balanceManagerKey)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
