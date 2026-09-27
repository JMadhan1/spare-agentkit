import "dotenv/config";

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v === undefined || v === "" ? fallback : Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

export const config = {
  servApiKey: process.env.SERV_API_KEY ?? "",
  servModel: process.env.SERV_MODEL || "gpt-6-luna",
  agentPrivateKey: (process.env.AGENT_PRIVATE_KEY ?? "") as `0x${string}` | "",
  stashAddress: (process.env.STASH_ADDRESS ?? "") as `0x${string}` | "",
  merchantAddress: (process.env.MERCHANT_ADDRESS ?? "") as `0x${string}` | "",
  networkId: process.env.NETWORK_ID || "base-sepolia",
  rpcUrl: process.env.RPC_URL || "https://sepolia.base.org",
  usdcAddress: (process.env.USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`,
  explorer: "https://sepolia.basescan.org",
  caps: {
    maxRoundupPerPayment: num("MAX_ROUNDUP_PER_PAYMENT", 2),
    dailyRoundupCap: num("DAILY_ROUNDUP_CAP", 10),
    walletFloor: num("WALLET_FLOOR", 1),
    sweepThreshold: num("SWEEP_THRESHOLD", 3),
  },
  port: num("PORT", 3000),
};

export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!config.servApiKey) missing.push("SERV_API_KEY");
  if (!config.agentPrivateKey) missing.push("AGENT_PRIVATE_KEY");
  if (!config.stashAddress) missing.push("STASH_ADDRESS");
  if (!config.merchantAddress) missing.push("MERCHANT_ADDRESS");
  return missing;
}
