import { DeepBookBot } from "./deepbookBot.js";
import { getEnv } from "./env.js";
import { log } from "./logger.js";

async function main() {
  const env = getEnv();

  const bot = new DeepBookBot(env.SUI_PRIVATE_KEY, env.SUI_ENV);

  log.info(
    { address: bot.getActiveAddress(), network: env.SUI_ENV },
    "Connected"
  );

  // Read-only L2 query
  // The Sui docs show getLevel2Range usage in the SDK example. :contentReference[oaicite:4]{index=4}
  // Params: (poolKey, tickSize, levels, includeAsks)
    const l2 = await bot.dbClient.getLevel2Range(
    env.POOL_KEY,
    env.L2_TICK_SIZE,
    env.L2_LEVELS,
    env.L2_INCLUDE_ASKS
  );

  log.info({ pool: env.POOL_KEY }, "Level2 snapshot");
  console.dir(l2, { depth: null });
}

main().catch((err) => {
  log.error({ err }, "Fatal error");
  process.exit(1);
});
