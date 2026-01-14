import { DeepBookClient } from "@mysten/deepbook-v3";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export class DeepBookBot {
  readonly suiClient: SuiClient;
  readonly dbClient: DeepBookClient;
  readonly keypair: Ed25519Keypair;
  readonly env: "testnet" | "mainnet";

  constructor(privateKey: string, env: "testnet" | "mainnet") {
    this.env = env;
    this.keypair = DeepBookBot.getSignerFromPK(privateKey);

    this.suiClient = new SuiClient({ url: getFullnodeUrl(env) });

    this.dbClient = new DeepBookClient({
      address: this.getActiveAddress(),
      env,
      client: this.suiClient,
    });
  }

  static getSignerFromPK(privateKey: string): Ed25519Keypair {
    const { schema, secretKey } = decodeSuiPrivateKey(privateKey);
    if (schema === "ED25519") return Ed25519Keypair.fromSecretKey(secretKey);
    throw new Error(`Unsupported schema: ${schema}`);
  }

  getActiveAddress(): string {
    return this.keypair.toSuiAddress();
  }
}
