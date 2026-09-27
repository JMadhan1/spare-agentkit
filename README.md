# Spare — round-up savings for the agent economy

Built for the [OpenServ SERV Hackathon Edition 01](https://www.openserv.ai/hackathon), **AgentKit track**.

Every USDC payment — yours or your AI agent's — gets rounded up. SERV Reasoning decides how much
spare change to save and, once the stash is big enough, which licensed IXS real-world-asset vault
to move it into. Code enforces every hard limit; the model only ever advises within them.

```
payment (real Base Sepolia tx)
        │
        ▼
SERV Reasoning ──▶ category, action (skip/roundup/boost), suspicious?
        │  (serv_prompt_guard on payment text, structured JSON output)
        ▼
policy.ts ──▶ clamps to per-payment cap, daily cap, wallet floor   (code, not the model)
        │
        ▼
AgentKit ViemWalletProvider ──▶ sends payment + round-up as separate on-chain transfers
        │
        ▼
stash balance crosses threshold
        │
        ▼
IXS Vault API (api-v2.ixs.finance, no auth) ──▶ live vault list, whitelist check,
        │                                        unsigned deposit calldata per vault
        ▼
SERV Reasoning (serv_shadow_agent) ──▶ picks a vault from the live facts, or "hold"
        │  code overrides the model if it ever points at a vault IXS won't accept
        ▼
dashboard shows the decision, the reasoning, and the on-chain proof
```

## Why this, not another treasury agent

We looked hard at building an "idle treasury → IXS vault" agent first. We dropped it: the IXS
Vaults track already has 7+ public entries doing exactly that (Vaulto, in particular, is a near-1:1
match down to the fee-on-yield model), and IXS's own test vaults are currently capacity-limited
(`maxDeposit = 0` — you can see this live in the dashboard's sweep panel, it's not simulated).

Round-up investing is a proven consumer habit (Acorns) that, per our research, has **zero prior
implementations on Coinbase AgentKit** — every AgentKit example and every AgentKit-track entry in
this hackathon is a payments/payroll tool, not a savings one. It also genuinely uses three of the
hackathon's sponsors in one loop: AgentKit moves the money, SERV Reasoning makes every judgment
call, IXS is the yield destination.

## What's real vs. simulated

- **Payments and round-up transfers are real, signed, broadcast transactions** on Base Sepolia —
  every one links to Basescan from the dashboard.
- **The IXS integration is live, not mocked.** `assessVaults()` calls IXS's actual production API
  (`api-v2.ixs.finance`) for all 4 of their live mainnet vaults, checks real whitelist status for
  the stash address, and asks IXS to build real deposit calldata. As of writing, IXS's own API
  reports `maxDeposit = 0` on their vaults (a live capacity limit, not something we invented — see
  the "Technical risks" section) — the sweep panel shows this exact reason for every vault, so a
  judge sees a genuine current constraint instead of a green checkmark that isn't real.
- **Every SERV Reasoning call is a direct, visible HTTP call** to `inference-api.openserv.ai`, not
  hidden behind `openserv-labs/sdk`'s `generate()` — the dashboard shows the model, which SERV
  features fired (`multipath`, `prompt_guard`, `shadow_agent`), and latency for each decision.

## Guardrails (code, never the model)

- Per-payment round-up cap, daily round-up cap, and a wallet floor the agent can never round below
  — all enforced in `src/policy.ts`, after the model answers, not instead of asking it.
- `serv_prompt_guard` on every round-up decision: payment memos are untrusted data an attacker (a
  malicious merchant, a compromised API) could stuff with instructions. Click "Try a booby-trapped
  memo" in the UI to see a memo that tries to raise its own multiplier and redirect stash funds —
  Spare flags it `suspicious` and holds the payment instead of acting on it.
- `serv_shadow_agent` validates every vault-sweep decision against the live IXS facts, and the code
  still refuses to forward a "deposit" into any vault whose own `depositReady` came back false.
- Spare never holds the stash's private key. The stash is an address the owner controls; sweeps
  produce a decision and IXS-built calldata for the owner (or their own agent) to sign, the same
  non-custodial shape as the payment wallet itself.

## Run it

```bash
npm install
cp .env.example .env
npm run keygen        # prints an AGENT_PRIVATE_KEY + its address — paste the key into .env
# fund that address with Base Sepolia ETH (for gas) and USDC (faucet.circle.com)
# set STASH_ADDRESS to any address you control (Spare only ever sends money to it, never signs for it)
# get SERV_API_KEY at console.openserv.ai/settings/keys (enable data collection at
#   console.openserv.ai/settings/organization first — required for hackathon eligibility)
npm run dev
```

Open `http://localhost:3000`. Set your savings rules in plain English, make a payment, and watch
the round-up land on Base Sepolia. Click "Check sweep now" to see SERV Reasoning read the live IXS
vault list and decide.

## Reusable by anyone: `spareActionProvider`

`src/agent.ts` exports `spareActionProvider`, an ordinary AgentKit `customActionProvider`. Any
AgentKit-based agent can add it to their own `actionProviders` array and immediately get
`spare_pay` / `spare_status` / `spare_sweep` tools — round-up savings become a drop-in behavior for
someone else's agent, not a standalone app only we can use. This is the SDK/B2B angle behind the
revenue model below.

## Revenue

- **Consumer:** ~$3/month subscription once past a free tier of rounded-up payments (the same
  shape Acorns has already proven works).
- **B2B:** `spareActionProvider` as an installable package — any AgentKit agent operator pays for
  round-ups as a feature, not each end user individually.
- We deliberately did **not** build an AUM or performance fee on the stash itself: charging a fee on
  discretionary, pooled yield allocation risks being read as investment-adviser activity. Spare
  never pools funds — the stash is the owner's own address — so the subscription/SDK model keeps
  the product non-custodial in substance, not just in the pitch.

## Technical risks (read before assuming any of this is a mock)

- **IXS mainnet vaults report `maxDeposit = 0` as of this submission.** This is IXS's own API
  answering live, not a limitation we added — the dashboard surfaces the vault's own error text
  verbatim. A real deposit would need IXS to raise vault capacity or the testnet path
  (`ixs-rwa-agent-skills`, Base Sepolia) to be unblocked; a filed IXS GitHub issue (#5) reports the
  same testnet vaults at `maxDeposit = 0` with no public faucet, opened days before this deadline.
- **Two of the four IXS vaults require KYC whitelisting** (`requiresWhitelist: true`); Spare checks
  this live via `vault_check_whitelist` and will never route into a vault the stash isn't cleared
  for.
- **Settlement kind differs per vault** — `sync` vs `async-erc7540` (multi-day claim). The allocator
  is instructed to prefer `sync` and to list settlement delay as a risk whenever it isn't.
- **`SERV_API_KEY` is required** for any of this to reason at all — without it every decision holds
  by default rather than silently guessing (see `decideRoundup`'s `blocked` path).
- **This is testnet money.** Nothing here custodies real user funds; addresses and amounts are
  demo-scale on purpose.
