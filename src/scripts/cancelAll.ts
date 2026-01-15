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

function normalizeOpenOrders(openRaw: any): any[] {
  if (Array.isArray(openRaw)) return openRaw;
  if (Array.isArray(openRaw?.open)) return openRaw.open;
  if (Array.isArray(openRaw?.orders)) return openRaw.orders;
  if (Array.isArray(openRaw?.data)) return openRaw.data;
  return [];
}

function extractOrderId(o: any): string | null {
  return (
    o?.orderId ??
    o?.id ??
    o?.order_id ??
    o?.orderID ??
    o?.order ??
    o?.order_id_str ??
    null
  );
}

async function main() {
  const env: any = getEnv();
  if (!env.POOL_KEY) throw new Error("Missing POOL_KEY in .env");

  const managerKey = String(env.BALANCE_MANAGER_KEY ?? "BM1").trim();
  const managerId = String(env.BALANCE_MANAGER_ID ?? "").trim(); // 0x...
  if (!managerId) throw new Error("Missing BALANCE_MANAGER_ID in .env");

  const bot = new DeepBookBot(env.SUI_PRIVATE_KEY, env.SUI_ENV, {
    balanceManagers: { [managerKey]: { address: managerId } },
  });

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
      const openRaw = await (bot.dbClient as any).accountOpenOrders(env.POOL_KEY, managerKey);
      const openList = normalizeOpenOrders(openRaw);

      orderIds = openList
        .map((o: any) => extractOrderId(o))
        .filter(Boolean) as string[];

      log.info(
        {
          openCount: orderIds.length,
          orderIds,
          managerKey,
          managerId,
        },
        "Open order IDs (by managerKey)"
      );
    } catch (e: any) {
      log.error(
        { err: e?.message ?? String(e), managerKey, managerId },
        "Failed to read open orders. As a fallback, set ORDER_IDS=... in .env."
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
  let builtAny = false;

  // cancel tx-builders generally want managerId (0x...), not "BM1"
  for (const orderId of orderIds) {
    const attempts: Array<[string, any[]]> = [
      ["txb,pool,managerId,orderId", [txb, env.POOL_KEY, managerId, orderId]],
      ["txb,pool,orderId,managerId", [txb, env.POOL_KEY, orderId, managerId]],
      ["txb,pool,orderId", [txb, env.POOL_KEY, orderId]],
      ["txb,orderId", [txb, orderId]],
    ];

    let builtThis = false;

    for (const [label, args] of attempts) {
      const res = await tryCall(fn, label, args);
      if (res.ok) {
        builtThis = true;
        builtAny = true;
        break;
      }
      errors.push({ orderId, label, err: res.err });
    }

    if (!builtThis) {
      log.warn({ orderId }, "Could not add cancel for this orderId (continuing).");
    }
  }

  if (!builtAny) {
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
