const MCP_URL = "https://api-v2.ixs.finance/mcp";

let rpcId = 0;

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; text: string }> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`IXS MCP ${name} HTTP ${res.status}`);
  const body = await res.text();
  const dataLine = body.split("\n").find((l) => l.startsWith("data:"));
  const msg = JSON.parse(dataLine ? dataLine.slice(5) : body);
  if (msg.error) throw new Error(`IXS MCP ${name}: ${msg.error.message}`);
  const text = (msg.result?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("\n");
  return { ok: !msg.result?.isError, text };
}

export interface VaultSummary {
  id: string;
  name: string;
  chainId: number;
  chainName: string;
  contractAddress: string;
  explorerUrl: string;
  requiresWhitelist: boolean;
  status: string;
  ttm: number | null;
  asset: string;
  assetDecimals: number;
}

export interface VaultAssessment extends VaultSummary {
  settlement: string;
  whitelisted: boolean | null;
  depositReady: boolean;
  depositNote: string;
  depositSteps: unknown[] | null;
}

// amount * 10**decimals as a Number overflows Number.MAX_SAFE_INTEGER for 18-decimal assets
// (a stash of a few USDC already exceeds 2^53 in wei-like units), so scale via the decimal string instead.
function toBaseUnits(amount: number, decimals: number): string {
  const [whole, frac = ""] = amount.toFixed(Math.min(decimals, 18)).split(".");
  const digits = (whole + frac.padEnd(decimals, "0")).replace(/^0+(?=\d)/, "");
  return digits || "0";
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function listVaults(): Promise<VaultSummary[]> {
  const res = await fetch("https://api-v2.ixs.finance/vaults?limit=100", { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`IXS /vaults HTTP ${res.status}`);
  const data: any = await res.json();
  const items: any[] = data.items ?? [];
  return items.map((v) => ({
    id: v.id,
    name: v.name,
    chainId: v.chainId,
    chainName: v.chainName,
    contractAddress: v.contractAddress,
    explorerUrl: v.explorerUrl,
    requiresWhitelist: Boolean(v.requiresWhitelist),
    status: v.status,
    ttm: typeof v.ttm === "number" ? v.ttm : null,
    asset: v.underlyingAsset?.symbol ?? "USDC",
    assetDecimals: typeof v.underlyingAsset?.decimals === "number" ? v.underlyingAsset.decimals : 6,
  }));
}

// Gathers every fact the allocator needs: settlement kind, whitelist status and whether IXS will
// actually build a deposit of this size right now (it reports live vault capacity when it won't).
export async function assessVaults(owner: string, amount: number): Promise<VaultAssessment[]> {
  const vaults = (await listVaults()).filter((v) => v.status === "active");
  return Promise.all(
    vaults.map(async (v): Promise<VaultAssessment> => {
      const [detail, wl, build] = await Promise.all([
        callTool("vault_get", { vaultId: v.id }).catch((e) => ({ ok: false, text: String(e) })),
        callTool("vault_check_whitelist", { vaultId: v.id, walletAddress: owner }).catch((e) => ({ ok: false, text: String(e) })),
        callTool("vault_build_request_deposit", {
          vaultId: v.id,
          ownerAddress: owner,
          assetAmount: toBaseUnits(amount, v.assetDecimals),
        }).catch((e) => ({ ok: false, text: String(e) })),
      ]);
      const d = parseJson(detail.text);
      const w = parseJson(wl.text);
      const b = build.ok ? parseJson(build.text) : null;
      return {
        ...v,
        settlement: d?.settlement ?? "unknown",
        whitelisted: typeof w?.whitelisted === "boolean" ? w.whitelisted : null,
        depositReady: build.ok,
        depositNote: build.ok ? "IXS built approve + deposit calldata" : build.text.slice(0, 200),
        depositSteps: b ? (b.steps ?? b.transactions ?? [b]) : null,
      };
    }),
  );
}
