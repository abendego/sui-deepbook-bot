import { log } from "./logger.js";

export function assertTradingAllowed(env: {
  ALLOW_TRADING: boolean;
  MAX_ORDER_USD: number;
}) {
  if (!env.ALLOW_TRADING) {
    throw new Error(
      "Trading disabled. Set ALLOW_TRADING=true in .env to enable (careful)."
    );
  }
  if (!(env.MAX_ORDER_USD > 0)) {
    throw new Error("MAX_ORDER_USD must be > 0");
  }
}

export function clampOrderUsd(requestedUsd: number, maxUsd: number) {
  const usd = Math.min(requestedUsd, maxUsd);
  if (usd <= 0) throw new Error("Order USD must be > 0");
  return usd;
}

export function infoSafety(env: any) {
  log.warn(
    {
      ALLOW_TRADING: env.ALLOW_TRADING,
      MAX_ORDER_USD: env.MAX_ORDER_USD,
      ORDER_SIZE_BASE: env.ORDER_SIZE_BASE,
    },
    "Safety config"
  );
}
