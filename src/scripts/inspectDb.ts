// @ts-nocheck
import { getEnv } from "../env.js";
import { DeepBookBot } from "../deepbookBot.js";

function listMethods(obj: any) {
  const out = new Set<string>();
  const banned = new Set(["caller", "callee", "arguments"]);

  const add = (o: any) => {
    if (!o) return;
    for (const k of Object.getOwnPropertyNames(o)) {
      if (banned.has(k)) continue;
      try {
        if (typeof o[k] === "function") out.add(k);
      } catch {}
    }
  };

  add(obj);
  add(Object.getPrototypeOf(obj));
  return Array.from(out).sort();
}

async function main() {
  const env: any = getEnv();
  const bot = new DeepBookBot(env.SUI_PRIVATE_KEY, env.SUI_ENV, {
    balanceManagers: env.BALANCE_MANAGER_ID
      ? { [env.BALANCE_MANAGER_KEY ?? "BM1"]: { address: env.BALANCE_MANAGER_ID } }
      : undefined,
  });

  const db: any = bot.dbClient;

  console.log("\n=== dbClient keys ===");
  console.log(Object.keys(db).sort().join(", "));

  const targets = ["poolProxy", "balanceManager", "deepBookAdmin", "deepBook"];
  for (const t of targets) {
    console.log(`\n=== ${t} methods ===`);
    const obj = db[t];
    if (!obj) {
      console.log("(missing)");
      continue;
    }
    console.log(listMethods(obj).join("\n"));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
