import { Transaction } from "@mysten/sui/transactions";
import { getEnv } from "../env.js";
import { log } from "../logger.js";
import { DeepBookBot } from "../deepbookBot.js";

function requireTrading(env: any) {
  if (!env.ALLOW_TRADING) {
    throw new Error("Trading disabled. Set ALLOW_TRADING=true in .env");
  }
}

function findMethod(obj: any, patterns: RegExp[]) {
  const names = new Set<string>();
  const banned = new Set(["caller", "callee", "arguments"]);

  const safeIsFn = (target: any, key: string) => {
    if (!target || banned.has(key)) return false;
    try {
      return typeof target[key] === "function";
    } catch {
      return false;
    }
  };

  for (const n of Object.getOwnPropertyNames(obj ?? {})) {
    if (safeIsFn(obj, n)) names.add(n);
  }

  const proto = Object.getPrototypeOf(obj);
  if (proto) {
    for (const n of Object.getOwnPropertyNames(proto)) {
      if (safeIsFn(obj, n)) names.add(n);
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

function normalizeOpenOrders(openRaw: any): any[] {
  if (Array.isArray(openRaw)) return openRaw;
  if (Array.isArray(openRaw?.open)) return openRaw.open;
  if (Array.isArray(openRaw?.orders)) return openRaw.orders;
  if (Array.isArray(openRaw?.data)) return openRaw.data;
  return [];
}

async function main() {
  const env: any = getEnv();
  requireTrading(env);

  if (!env.POOL_KEY) throw new Error("Missing POOL_KEY in .env");

  // ✅ Trim fixes hidden \r / whitespace issues
  const managerKey = String(env.BALANCE_MANAGER_KEY ?? "BM1").trim();
  const managerId = String(env.BALANCE_MANAGER_ID ?? "").trim(); // 0x...
  if (!managerId) throw new Error("Missing BALANCE_MANAGER_ID (0x...) in .env");

  const bot = new DeepBookBot(env.SUI_PRIVATE_KEY, env.SUI_ENV, {
    balanceManagers: { [managerKey]: { address: managerId } },
  });

  const ownerAddress = bot.getActiveAddress();

  const deep = (bot.dbClient as any).deepBook;
  if (!deep) throw new Error("dbClient.deepBook is missing (unexpected)");

  // Find a "place limit order" builder
  const { hit, names } = findMethod(deep, [/place/i, /(limit|order)/i]);
  if (!hit) {
    throw new Error(
      `Could not find a deepBook place-limit-order method. Available deepBook methods:\n${names.join("\n")}`
    );
  }

  // Read best bid from L2 (true => bids, in your repo)
  const l2Bids = await bot.dbClient.getLevel2Range(env.POOL_KEY, 0.1, 10, true);
  const bestBid = Number(l2Bids?.prices?.[0]);
  if (!bestBid || Number.isNaN(bestBid)) throw new Error("Could not read L2 best bid.");

  // Make it a truly "bad" bid so it MUST rest
  const mult = Number(env.BAD_BID_MULT ?? 0.5); // 50% of best bid by default
  if (!(mult > 0 && mult < 1)) {
    throw new Error("BAD_BID_MULT must be between 0 and 1 (e.g. 0.5 or 0.2).");
  }

  const price = bestBid * mult;

  // Keep order small
  const maxUsd = Number(env.MAX_ORDER_USD ?? 2);
  const baseQty = Math.max(0.01, maxUsd / price);

  log.warn(
    {
      ownerAddress,
      pool: env.POOL_KEY,
      managerKey,
      managerId,
      bestBid,
      badBidMult: mult,
      price,
      baseQty,
      deepBookMethod: hit,
    },
    "Placing BAD BID limit order (should rest on the book)"
  );

  const txb = new Transaction();
  const fn = deep[hit].bind(deep);

  // IMPORTANT: tx-builders want managerId (object id), not "BM1"
  const attempts: Array<[string, any[]]> = [
    ["txb,pool,managerId,side,price,qty", [txb, env.POOL_KEY, managerId, "bid", price, baseQty]],
    ["txb,pool,side,price,qty,managerId", [txb, env.POOL_KEY, "bid", price, baseQty, managerId]],
    ["txb,pool,managerId,isBid,price,qty", [txb, env.POOL_KEY, managerId, true, price, baseQty]],
    ["txb,pool,isBid,price,qty,managerId", [txb, env.POOL_KEY, true, price, baseQty, managerId]],
  ];

  let built = false;
  const errors: any[] = [];

  for (const [label, args] of attempts) {
    const res = await tryCall(fn, label, args);
    if (res.ok) {
      built = true;
      log.info({ usedSignature: res.label }, "✅ Built bad-bid limit order tx");
      break;
    } else {
      errors.push(res);
    }
  }

  if (!built) {
    log.error({ errors }, "All place-limit-order signatures failed");
    throw new Error("Could not build bad-bid limit order tx (see errors above).");
  }

  const exec = await bot.suiClient.signAndExecuteTransaction({
    signer: bot.keypair,
    transaction: txb,
    options: { showEffects: true, showObjectChanges: true, showBalanceChanges: true },
  });

  const status = exec?.effects?.status?.status ?? "UNKNOWN";
  log.info({ digest: exec.digest, status }, "✅ Bad-bid order tx executed");

  // If the tx aborted, we stop right here (don’t trust open orders reads)
  if (status !== "success") {
    log.error({ effects: exec.effects }, "❌ Transaction did not succeed (order not placed).");
    return;
  }

  // Now reads should work because we injected mapping into DeepBookClient
  try {
    const openRaw = await (bot.dbClient as any).accountOpenOrders(env.POOL_KEY, managerKey);
    const openList = normalizeOpenOrders(openRaw);
    log.info({ openCount: openList.length, open: openList }, "Open orders (by managerKey)");
  } catch (e: any) {
    log.warn(
      { err: e?.message ?? String(e), managerKey, managerId, ownerAddress },
      "Open orders read failed (mapping still not resolving)."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
