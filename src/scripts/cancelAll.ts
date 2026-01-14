import { Transaction } from "@mysten/sui/transactions";
import { getEnv } from "../env.js";
import { log } from "../logger.js";
import { DeepBookBot } from "../deepbookBot.js";

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
    // @ts-ignore
    await fn(...args);
    return { ok: true as const, label };
  } catch (e: any) {
    return { ok: false as const, label, err: e?.message ?? String(e) };
  }
}

function tryPatchDeepBookConfig(dbClient: any, managerKey: string, managerId: string) {
  const cfg =
    dbClient?.config ??
    dbClient?.deepBookConfig ??
    dbClient?.deepbookConfig ??
    dbClient?.deepBook?.config ??
    null;

  const deep = dbClient?.deepBook ?? null;

  let ok = false;
  const notes: string[] = [];

  const setterCandidates = [
    "setBalanceManager",
    "setBalanceManagerId",
    "setBalanceManagerIds",
    "addBalanceManager",
    "registerBalanceManager",
  ];

  for (const name of setterCandidates) {
    const fn = cfg?.[name] ?? deep?.[name];
    if (typeof fn === "function") {
      try {
        fn.call(cfg ?? deep, managerKey, managerId);
        notes.push(`used ${name}(key,id)`);
        ok = true;
        break;
      } catch {
        // keep trying
      }
    }
  }

  if (!ok) {
    const targets = [
      cfg?.balanceManagers,
      cfg?.balanceManagerIds,
      cfg?.managerIds,
      cfg?.managers,
      dbClient?.balanceManagerIds,
    ];

    for (const t of targets) {
      // Map
      if (t && typeof t.set === "function") {
        try {
          t.set(managerKey, managerId);
          notes.push("set Map(managerKey->managerId)");
          ok = true;
          break;
        } catch {}
      }
      // Object
      if (t && typeof t === "object" && !Array.isArray(t)) {
        try {
          t[managerKey] = managerId;
          notes.push("set object[managerKey]=managerId");
          ok = true;
          break;
        } catch {}
      }
    }
  }

  log.info({ managerKey, managerId, ok, notes }, "DeepBookConfig patch attempt (best-effort)");
  return ok;
}

async function main() {
  const env: any = getEnv();
  if (!env.POOL_KEY) throw new Error("Missing POOL_KEY in .env");

  const bot = new DeepBookBot(env.SUI_PRIVATE_KEY, env.SUI_ENV);

  const managerId = env.BALANCE_MANAGER_ID; // ✅ 0x...
  const managerKey = env.BALANCE_MANAGER_KEY ?? env.MANAGER_KEY ?? "BM1"; // ✅ BM1

  if (!managerId) throw new Error("Missing BALANCE_MANAGER_ID in .env");

  // Patch mapping for this run (so open-order reads work)
  tryPatchDeepBookConfig(bot.dbClient as any, managerKey, managerId);

  // 1) Collect orderIds
  let orderIds: string[] = [];

  if (env.ORDER_IDS) {
    orderIds = String(env.ORDER_IDS)
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    log.info({ count: orderIds.length, orderIds }, "Using ORDER_IDS from .env");
  } else {
    try {
      const open = await (bot.dbClient as any).accountOpenOrders(env.POOL_KEY, managerKey);
      orderIds = (open ?? []).map((o: any) => o.orderId ?? o.id).filter(Boolean);
      log.info({ openCount: orderIds.length, orderIds }, "Open order IDs (by managerKey)");
    } catch (e: any) {
      log.error(
        { err: e?.message ?? String(e), managerKey },
        "Failed to read open orders (mapping issue). Set ORDER_IDS=... in .env as fallback."
      );
      process.exit(1);
    }
  }

  if (orderIds.length === 0) {
    log.info("No open orders to cancel.");
    return;
  }

  const deep = (bot.dbClient as any).deepBook;
  if (!deep) throw new Error("dbClient.deepBook is missing (unexpected)");

  const { hit, names } = findMethod(deep, [/cancel/i, /order/i]);
  if (!hit) {
    throw new Error(
      `Could not find deepBook cancel-order method. Available deepBook methods:\n${names.join("\n")}`
    );
  }

  const txb = new Transaction();
  const fn = deep[hit].bind(deep);

  const errors: any[] = [];
  let built = false;

  // ✅ cancel tx-builders generally want managerId (0x...), not "BM1"
  for (const orderId of orderIds) {
    const attempts: Array<[string, any[]]> = [
      ["txb,pool,managerId,orderId", [txb, env.POOL_KEY, managerId, orderId]],
      ["txb,pool,orderId,managerId", [txb, env.POOL_KEY, orderId, managerId]],
      ["txb,pool,orderId", [txb, env.POOL_KEY, orderId]],
      ["txb,orderId", [txb, orderId]],
    ];

    let okOne = false;
    for (const [label, args] of attempts) {
      const res = await tryCall(fn, label, args);
      if (res.ok) {
        okOne = true;
        built = true;
        break;
      }
      errors.push({ orderId, label, err: res.err });
    }

    if (!okOne) {
      log.warn({ orderId }, "Could not add cancel for this orderId (continuing).");
    }
  }

  if (!built) {
    log.error({ errors }, "All cancel signatures failed");
    throw new Error("Could not build cancel tx (see errors above).");
  }

  log.warn({ deepBookMethod: hit, count: orderIds.length }, "Executing cancel tx...");
  const exec = await bot.suiClient.signAndExecuteTransaction({
    signer: bot.keypair,
    transaction: txb,
    options: { showEffects: true, showObjectChanges: true },
  });

  log.info({ digest: exec.digest }, "✅ Cancel tx executed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
