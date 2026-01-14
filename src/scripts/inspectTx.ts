import { getEnv } from "../env.js";
import { DeepBookBot } from "../deepbookBot.js";

async function main() {
  const digest = process.argv[2];
  if (!digest) throw new Error("Usage: pnpm inspect:tx <digest>");

  const env = getEnv();
  const bot = new DeepBookBot(env.SUI_PRIVATE_KEY, env.SUI_ENV);

  const tx = await bot.suiClient.getTransactionBlock({
    digest,
    options: {
      showObjectChanges: true,
      showEffects: true,
      showInput: true,
      showEvents: true,
    },
  });

  console.log("digest:", tx.digest);
  console.log("events:", tx.events);
  console.log("objectChanges:", tx.objectChanges);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
