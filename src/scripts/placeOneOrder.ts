import { Transaction } from "@mysten/sui/transactions";
import { getEnv } from "../env.js";
import { log } from "../logger.js";
import { DeepBookBot } from "../deepbookBot.js";
import * as deepbookPkg from "@mysten/deepbook-v3";

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

/**
 * Patch the module-level DeepBookConfig (from @mysten/deepbook-v3) so read helpers
 * can resolve managerKey ("BM1") -> managerId (0x...).
 *
 * Your logs showed bot.dbClient has no usable config object (cfgKeys: []),
 * so patching that won't help.
 */
function patchDeepBookGlobalConfig(managerKey: string, managerId: string) {
  // DeepBookConfig export shape varies by version
  const cfg: any =
    (deepbookPkg as any).DeepBookConfig ??
    (deepbookPkg as any).deepBookConfig ??
    (deepbookPkg as any).config ??
    null;

  const notes: string[] = [];
  let ok = false;

  if (!cfg) {
    log.info({ managerKey, managerId }, "DeepBookConfig not found on deepbook package (skipping patch).");
    return false;
  }

  // 1) Try setter-like methods on config
  const setterCandidates = [
    "setBalanceManager",
    "setBalanceManagerId",
    "setBalanceManagerIds",
    "addBalanceManager",
    "registerBalanceManager",
    "registerBalanceManagerId",
  ];

  for (const name of setterCandidates) {
    const fn = cfg?.[name];
    if (typeof fn === "function") {
      try {
        fn.call(cfg, managerKey, managerId);
        notes.push(`used ${name}(key,id)`);
        ok = true;
        break;
      } catch {
        try {
          fn.call(cfg, managerId, managerKey);
          notes.push(`used ${name}(id,key)`);
          ok = true;
          break;
        } catch (e: any) {
          notes.push(`${name} threw: ${e?.message ?? String(e)}`);
        }
      }
    }
  }

  // 2) Map-based storage candidates
  if (!ok) {
    const mapCandidates = [
      cfg?.balanceManagerIds,
      cfg?.balanceManagers,
      cfg?.managerIds,
      cfg?.managers,
    ];
    for (const m of mapCandidates) {
      if (m && typeof m.set === "function") {
        try {
          m.set(managerKey, managerId);
          notes.push("set Map(managerKey->managerId)");
          ok = true;
          break;
        } catch (e: any) {
          notes.push(`Map.set threw: ${e?.message ?? String(e)}`);
        }
      }
    }
  }

  // 3) Plain object storage candidates
  if (!ok) {
    const objCandidates = [
      cfg?.balanceManagerIds,
      cfg?.balanceManagers,
      cfg?.managerIds,
      cfg?.managers,
    ];
    for (const o of objCandidates) {
      if (o && typeof o === "object" && !Array.isArray(o)) {
        try {
          o[managerKey] = managerId;
          notes.push("set object[managerKey]=managerId");
          ok = true;
          break;
        } catch (e: any) {
          notes.push(`object assign threw: ${e?.message ?? String(e)}`);
        }
      }
    }
  }

  log.info(
    { managerKey, managerId, ok, notes, cfgKeys: Object.keys(cfg ?? {}) },
    "DeepBookConfig global patch attempt (best-effort)"
  );

  return ok;
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
  requireTrading(env);

  if (!env.POOL_KEY) throw new Error("Missing POOL_KEY in .env");

  const bot = new DeepBookBot(env.SUI_PRIVATE_KEY, env.SUI_ENV);

  const ownerAddress = bot.getActiveAddress(); // wallet address (reads)
  const managerId = env.BALANCE_MANAGER_ID;    // MUST be 0x...
  const managerKey = env.BALANCE_MANAGER_KEY ?? "BM1"; // "BM1"

  if (!managerId) throw new Error("Missing BALANCE_MANAGER_ID (0x...) in .env");

  // Patch global config so reads that use BM1 stop exploding
  patchDeepBookGlobalConfig(managerKey, managerId);

  const deep = (bot.dbClient as any).deepBook;
  if (!deep) throw new Error("dbClient.deepBook is missing (unexpected)");

  // Find a "place limit order" builder
  const { hit, names } = findMethod(deep, [/place/i, /(limit|order)/i]);
  if (!hit) {
    throw new Error(
      `Could not find a deepBook place-limit-order method. Available deepBook methods:\n${names.join("\n")}`
    );
  }

  // Get L2 best
  const l2 = await bot.dbClient.getLevel2Range(env.POOL_KEY, 0.1, 10, true);
  const bestPrice = Number(l2?.prices?.[0]);
  if (!bestPrice || Number.isNaN(bestPrice)) throw new Error("Could not read L2 best price.");

  const maxUsd = Number(env.MAX_ORDER_USD ?? 2);
  const price = bestPrice * 0.97;
  const baseQty = Math.max(0.01, maxUsd / price);

  log.warn(
    { ownerAddress, managerKey, managerId, pool: env.POOL_KEY, price, baseQty, deepBookMethod: hit },
    "Placing ONE limit order via tx-builder"
  );

  const txb = new Transaction();
  const fn = deep[hit].bind(deep);

  // IMPORTANT: tx-builders want managerId (object id), not "BM1"
  const attempts = [
    ["txb,pool,managerId,side,price,qty", [txb, env.POOL_KEY, managerId, "bid", price, baseQty]],
    ["txb,pool,side,price,qty,managerId", [txb, env.POOL_KEY, "bid", price, baseQty, managerId]],
    ["txb,pool,managerId,isBid,price,qty", [txb, env.POOL_KEY, managerId, true, price, baseQty]],
    ["txb,pool,isBid,price,qty,managerId", [txb, env.POOL_KEY, true, price, baseQty, managerId]],
  ];

  let built = false;
  const errors: any[] = [];

  for (const [label, args] of attempts) {
    const res = await tryCall(fn, label as string, args as any[]);
    if (res.ok) {
      built = true;
      log.info({ usedSignature: res.label }, "✅ Built limit order tx");
      break;
    } else {
      errors.push(res);
    }
  }

  if (!built) {
    log.error({ errors }, "All place-limit-order signatures failed");
    throw new Error("Could not build limit order tx (see errors above).");
  }

  const exec = await bot.suiClient.signAndExecuteTransaction({
    signer: bot.keypair,
    transaction: txb,
    options: { showEffects: true, showObjectChanges: true, showBalanceChanges: true },
  });

  log.info({ digest: exec.digest }, "✅ Order tx executed");

  // Best-effort open orders read (now that global mapping is patched)
  try {
    const open = await (bot.dbClient as any).accountOpenOrders(env.POOL_KEY, managerKey);
    log.info({ open }, "Open orders (by managerKey)");
  } catch (e: any) {
    log.warn(
      { err: e?.message ?? String(e), managerKey, managerId, ownerAddress },
      "Open orders read still failed (mapping). Order was still placed."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
