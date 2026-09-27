import { ViemWalletProvider } from "@coinbase/agentkit";
import { createWalletClient, encodeFunctionData, erc20Abi, formatUnits, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { config } from "./config.js";

// AgentKit fires an unawaited telemetry ping on wallet-provider construction (agent_initialization).
// In sandboxes without outbound access to Coinbase's analytics endpoint that call rejects, and since
// AgentKit never attaches a .catch, Node treats it as an unhandled rejection and exits. Swallow only
// that one event name so a third-party telemetry failure can never take down this server.
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (msg.includes("HTTP error! status")) return;
  throw reason;
});

const PLACEHOLDER_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001";

const account = privateKeyToAccount((config.agentPrivateKey || PLACEHOLDER_KEY) as `0x${string}`);
const client = createWalletClient({ account, chain: baseSepolia, transport: http(config.rpcUrl) });

// AgentKit's wallet provider is the only thing that signs and sends transactions.
export const walletProvider = new ViemWalletProvider(client);

let queue: Promise<unknown> = Promise.resolve();

// Serialize sends so concurrent payments never race on the account nonce.
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

export const wallet = {
  address: walletProvider.getAddress() as `0x${string}`,

  async usdcBalance(owner: `0x${string}` | string): Promise<number> {
    const raw = (await walletProvider.readContract({
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner as `0x${string}`],
    })) as bigint;
    return Number(formatUnits(raw, 6));
  },

  async ethBalance(): Promise<number> {
    return Number(formatUnits(await walletProvider.getBalance(), 18));
  },

  transferUsdc(to: `0x${string}`, amount: number): Promise<`0x${string}`> {
    return serial(async () => {
      const hash = await walletProvider.sendTransaction({
        to: config.usdcAddress,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, parseUnits(amount.toFixed(6), 6)] }),
      });
      const receipt = await walletProvider.waitForTransactionReceipt(hash);
      if (receipt?.status && receipt.status !== "success") throw new Error(`transfer reverted: ${hash}`);
      return hash;
    });
  },
};
