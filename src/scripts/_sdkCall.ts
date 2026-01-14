// src/scripts/_sdkCall.ts
import { Transaction } from "@mysten/sui/transactions";

/**
 * Calls an SDK helper that may be:
 *  - (txb, ...args) => void
 *  - (...args) => (txb) => void
 *  - (...args) => void  (executes internally)
 *
 * Returns { built: boolean, execResult?: any }
 */
export async function callSdkHelper(
  helper: any,
  txb: Transaction,
  ...args: any[]
): Promise<{ built: boolean; execResult?: any }> {
  if (typeof helper !== "function") throw new Error("helper is not a function");

  // Case 1: helper expects txb first
  if (helper.length >= 1) {
    try {
      const r = await helper(txb, ...args);
      return { built: true, execResult: r };
    } catch {
      // fallthrough
    }
  }

  // Case 2: helper returns a builder function
  try {
    const maybeBuilder = await helper(...args);
    if (typeof maybeBuilder === "function") {
      await maybeBuilder(txb);
      return { built: true };
    }
  } catch {
    // fallthrough
  }

  // Case 3: helper executes internally (no txb)
  const r = await helper(...args);
  return { built: false, execResult: r };
}
