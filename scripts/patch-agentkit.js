// @coinbase/agentkit's action-providers barrel unconditionally requires ~30 action providers we
// never use (across, opensea, zora, jupiter, zerodev, x402, ...), several of which pull in
// ESM-only transitive dependencies with no CJS build at all (e.g. @across-protocol/app-sdk).
// Node's CJS loader crashes with ERR_REQUIRE_ESM the instant that barrel loads, on any platform
// that doesn't support require()-of-ESM the way local Node 25 silently does (observed: Vercel's
// Node 24.x runtime does not). Since none of those providers are named anywhere in our own code,
// this postinstall step strips their requires from the barrel, keeping only what we actually use:
// actionDecorator, actionProvider (base class), customActionProvider (our spare* tools), and
// wallet (agentkit.js's own default fallback provider). Runs after every `npm install`, including
// Vercel's build-time install, so the fix travels with the dependency rather than living only in
// this machine's node_modules.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const TARGETS = [
  {
    file: "node_modules/@coinbase/agentkit/dist/action-providers/index.js",
    keep: new Set(["./actionDecorator", "./actionProvider", "./customActionProvider", "./wallet"]),
  },
  {
    // Same problem one layer over: cdp*/privy*/zeroDev*/solana* wallet providers we never use,
    // several pulling the exact ESM-only SDKs this whole patch exists to dodge (cdp-sdk -> jose,
    // zeroDev -> @zerodev/sdk).
    file: "node_modules/@coinbase/agentkit/dist/wallet-providers/index.js",
    keep: new Set(["./walletProvider", "./evmWalletProvider", "./viemWalletProvider"]),
  },
];

for (const { file, keep } of TARGETS) {
  if (!existsSync(file)) {
    console.warn(`patch-agentkit: ${file} not found, skipping (agentkit may not be installed)`);
    continue;
  }
  const original = readFileSync(file, "utf8");
  const patched = original.replace(/^__exportStar\(require\("(\.\/[a-zA-Z0-9_-]+)"\), exports\);\n/gm, (line, name) =>
    keep.has(name) ? line : "",
  );
  if (patched === original) {
    console.log(`patch-agentkit: no change for ${file} (already patched or upstream shape changed)`);
  } else {
    writeFileSync(file, patched);
    console.log(`patch-agentkit: stripped unused requires from ${file}`);
  }
}
