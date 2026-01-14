import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const EnvSchema = z.object({
  SUI_ENV: z.enum(["testnet", "mainnet"]).default("testnet"),
  SUI_PRIVATE_KEY: z.string().trim().min(1, "Missing SUI_PRIVATE_KEY"),

  POOL_KEY: z.string().trim().default("SUI_DBUSDC"),

  L2_TICK_SIZE: z.coerce.number().positive().default(0.1),
  L2_LEVELS: z.coerce.number().int().positive().max(200).default(50),
  L2_INCLUDE_ASKS: z.coerce.boolean().default(true),

  ALLOW_TRADING: z.coerce.boolean().default(false),
  MAX_ORDER_USD: z.coerce.number().positive().default(2),
  ORDER_SIZE_BASE: z.coerce.number().positive().default(0.1),

  BASE_COIN: z.string().trim().default("SUI"),
  QUOTE_COIN: z.string().trim().default("DBUSDC"),

  // Manager object id (required for trading scripts; optional overall)
  BALANCE_MANAGER_ID: z.string().trim().optional(),
  BALANCE_MANAGER_KEY: z.string().trim().optional(), // alias, optional
});

export type Env = z.infer<typeof EnvSchema>;

export function getEnv(): Env {
  return EnvSchema.parse(process.env);
}
