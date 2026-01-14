import { getEnv } from "../env.js";
import { DeepBookBot } from "../deepbookBot.js";

async function main() {
  const env: any = getEnv();

  const bot = new DeepBookBot(env.SUI_PRIVATE_KEY, env.SUI_ENV);

  const managerKey = env.BALANCE_MANAGER_KEY; // e.g. "BM1" (label)
  const managerId = env.BALANCE_MANAGER_ID;   // e.g. "0x..." (object id)

  if (!managerId) throw new Error("Missing BALANCE_MANAGER_ID in .env");

  console.log("Using managerKey (label):", managerKey ?? "(none)");
  console.log("Using managerId (object):", managerId);

  // ✅ On-chain existence check (object id only)
  const obj = await bot.suiClient.getObject({
    id: managerId,
    options: { showType: true, showOwner: true, showContent: true },
  });

  if ((obj as any).error) {
    console.error("❌ Manager object not found / invalid id:", (obj as any).error);
    process.exit(1);
  }

  console.log("✅ Manager object exists.");
  console.log("type:", obj.data?.type);
  console.log("owner:", obj.data?.owner);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
