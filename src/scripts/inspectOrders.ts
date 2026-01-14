import { getEnv } from "../env.js";
import { DeepBookBot } from "../deepbookBot.js";

function keys(obj: any) {
  if (!obj) return [];
  return Object.keys(obj);
}

function protoKeys(obj: any) {
  if (!obj) return [];
  const p = Object.getPrototypeOf(obj);
  return p ? Object.getOwnPropertyNames(p) : [];
}

async function main() {
  const env = getEnv();
  const bot = new DeepBookBot(env.SUI_PRIVATE_KEY, env.SUI_ENV);

  console.log("dbClient keys:", keys(bot.dbClient));
  console.log("dbClient proto keys:", protoKeys(bot.dbClient));

  // Likely modules
  const candidates = [
    "orders",
    "order",
    "trading",
    "trade",
    "market",
    "clob",
    "pools",
    "pool",
  ];

  for (const name of candidates) {
    const v = (bot.dbClient as any)[name];
    console.log(`\n== ${name} ==`);
    console.log("keys:", keys(v));
    console.log("proto keys:", protoKeys(v));
  }

  // Also search for any method names containing "order" or "cancel" directly on client
  const methods = protoKeys(bot.dbClient).filter(
    (k) => /order|cancel|place|bid|ask|limit|market/i.test(k)
  );
  console.log("\nMatched dbClient methods:", methods);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
