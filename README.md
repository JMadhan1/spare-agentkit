<div align="center">

# 🪙 Spare

### Round-up savings for the agent economy

*Every payment your AI agent makes leaves spare change on the table. Spare picks it up.*

[![AgentKit](https://img.shields.io/badge/Coinbase-AgentKit-3d6fb4?style=flat-square)](https://docs.cdp.coinbase.com/agentkit)
[![SERV Reasoning](https://img.shields.io/badge/OpenServ-SERV%20Reasoning-cb6833?style=flat-square)](https://docs.openserv.ai/what-is-serv)
[![IXS Vaults](https://img.shields.io/badge/IXS-RWA%20Vaults-3f8f5f?style=flat-square)](https://www.ixs.finance/)
[![Base Sepolia](https://img.shields.io/badge/chain-Base%20Sepolia-0052ff?style=flat-square)](https://sepolia.basescan.org)

Built in ~20 hours for the [SERV Hackathon Edition 01](https://www.openserv.ai/hackathon) · AgentKit track

</div>

---

## The pitch

Acorns proved people will save money they never miss, one round-up at a time. Nobody has built
that for the agent economy — where an AI agent is now the one holding the wallet and making the
purchase. **Spare is Acorns for that world.**

Every USDC payment — yours or your agent's — gets rounded up. **SERV Reasoning** judges each one:
what kind of spend is this, should it be saved, boosted, or skipped, and is the payment text itself
trying to manipulate the agent. **AgentKit** moves the money — the payment and the round-up are two
separate, real, signed transactions. Once the stash is big enough, SERV reads live data from
**IXS Finance's** vault API and decides whether to allocate into a licensed real-world-asset yield
vault, or hold — and code refuses to let it deposit anywhere IXS itself won't accept.

Three sponsors, one loop, zero mocks.

```
 payment (real Base Sepolia tx)
          │
          ▼
 ┌────────────────────┐   category · action (skip / roundup / boost) · suspicious?
 │   SERV Reasoning    │──────────────────────────────────────────────────────────▶
 │  serv_prompt_guard  │   payment text is treated as untrusted, not instructions
 └────────────────────┘
          │
          ▼
 ┌────────────────────┐
 │     policy.ts       │   per-payment cap · daily cap · wallet floor — CODE, not the model
 └────────────────────┘
          │
          ▼
 ┌────────────────────┐
 │  AgentKit wallet    │   sends payment + round-up as two on-chain transfers
 └────────────────────┘
          │
          ▼
   stash crosses its sweep threshold
          │
          ▼
 ┌────────────────────┐
 │  IXS Vault API      │   live vault list · whitelist check · unsigned deposit calldata
 └────────────────────┘
          │
          ▼
 ┌────────────────────┐
 │   SERV Reasoning    │   picks a ready vault, or "hold" — code overrides if the model
 │  serv_shadow_agent  │   ever points at a vault IXS itself won't accept
 └────────────────────┘
          │
          ▼
   dashboard shows the decision, the reasoning trace, and the on-chain proof
```

---

## Why this, not another treasury agent

We looked hard at building an "idle treasury → IXS vault" agent first — it's the obvious idea for
the IXS Vaults track. We dropped it after finding:

| Signal | What we found |
|---|---|
| Competing entries | 7+ public submissions already do exactly this; **Vaulto** matches down to the same 25bps fee-on-yield model |
| Live blocker | IXS's own test vaults are currently capacity-limited (`maxDeposit = 0`) — verifiable live, not a claim |
| Name collision | "Idle Finance" is already a $40M+ DeFi protocol in the same conceptual space |

Round-up investing, by contrast, has **zero prior implementations on Coinbase AgentKit** — every
official AgentKit example and every AgentKit-track entry in this hackathon is a payments or payroll
tool, not a savings one. It's a proven consumer habit nobody has ported to agent-native money yet.

---

## What's real vs. simulated

Nothing here is a mock dressed up for a demo. Specifically:

- 🟢 **Payments and round-up transfers are real, signed, broadcast transactions** on Base Sepolia —
  every one links straight to Basescan from the dashboard.
- 🟢 **The IXS integration is live.** `assessVaults()` calls IXS's actual production API
  (`api-v2.ixs.finance`) for all 4 of their real mainnet vaults, checks real whitelist status for
  the stash address, and asks IXS to build real deposit calldata. IXS's own API currently reports
  `maxDeposit = 0` on every vault — the sweep panel shows that exact reason, verbatim, instead of a
  green checkmark that isn't real.
- 🟢 **Every SERV Reasoning call is a direct, visible HTTP call** to `inference-api.openserv.ai`,
  not hidden behind `openserv-labs/sdk`'s `generate()`. The dashboard shows the model, which SERV
  features fired (`prompt_guard`, `shadow_agent`), and latency for every decision.

---

## Guardrails — code, never the model

| Guardrail | Enforced by | What it stops |
|---|---|---|
| Per-payment / daily round-up caps, wallet floor | `src/policy.ts` | The model can *advise* a boost; code clamps the actual amount every time |
| `serv_prompt_guard` on every payment | SERV Reasoning, server-side | A malicious merchant/API memo trying to raise its own multiplier or redirect funds — click **"Try a booby-trapped memo"** in the UI to watch it get refused |
| `serv_shadow_agent` + a hard code check | `decideSweep()` | The model recommending a vault; code refuses to forward "deposit" unless IXS's own API says that vault is `depositReady` |
| Non-custodial stash | Wallet design | Spare never holds the stash's private key — sweeps produce a decision + IXS-built calldata for the owner to sign, never a fund pool |

---

## Run it

```bash
npm install
cp .env.example .env
npm run keygen        # prints an AGENT_PRIVATE_KEY + its address — paste the key into .env
# fund that address: Base Sepolia ETH (any faucet) + USDC (faucet.circle.com)
# set STASH_ADDRESS to any address you control — Spare only ever sends money to it, never signs for it
# get SERV_API_KEY at console.openserv.ai/settings/keys
#   (enable data collection at console.openserv.ai/settings/organization first — required for hackathon eligibility)
npm run dev
```

Open `http://localhost:3000`. Write your savings rules in plain English, make a payment, and watch
the round-up land on Base Sepolia in real time. Click **"Check sweep now"** to see SERV Reasoning
read the live IXS vault list and decide.

---

## Reusable by anyone: `spareActionProvider`

`src/agent.ts` exports `spareActionProvider` — an ordinary AgentKit `customActionProvider`. Any
AgentKit-based agent can drop it into their own `actionProviders` array and immediately gain
`spare_pay` / `spare_status` / `spare_sweep` tools. Round-up savings become a feature anyone's agent
can install, not a standalone app only we can use — this is the B2B angle behind the revenue model
below.

## Revenue

- **Consumer** — a ~$3/month subscription past a free tier of rounded-up payments, the same shape
  Acorns already proved works.
- **B2B** — `spareActionProvider` as an installable package: agent operators pay once for the
  feature, not per end user.
- **Deliberately no AUM or performance fee on the stash itself.** Charging a fee on discretionary,
  pooled yield allocation risks reading as investment-adviser activity. Spare never pools funds —
  the stash is the owner's own address — so the subscription/SDK model keeps the product
  non-custodial in substance, not just in the pitch.

---

## Technical risks — read before assuming any of this is smoke and mirrors

- **IXS mainnet vaults report `maxDeposit = 0` as of this submission.** IXS's own API answering
  live, not a limitation we invented — the dashboard shows the vault's own error text verbatim. A
  real deposit needs IXS to raise vault capacity, or the testnet path (`ixs-rwa-agent-skills`, Base
  Sepolia) to be unblocked — a filed IXS GitHub issue (#5) reports the same testnet vaults blocked,
  with no public faucet, opened days before this deadline.
- **Two of the four IXS vaults require KYC whitelisting.** Spare checks this live via
  `vault_check_whitelist` and will never route into a vault the stash isn't cleared for.
- **Settlement kind differs per vault** — `sync` vs. `async-erc7540` (multi-day claim). The
  allocator is instructed to prefer `sync` and list settlement delay as a risk whenever it isn't.
- **`SERV_API_KEY` is required for any of this to reason at all** — without it, every decision holds
  by default rather than silently guessing.
- **This is testnet money.** Nothing here custodies real user funds; addresses and amounts are
  demo-scale on purpose.

<div align="center">

*Built with [Coinbase AgentKit](https://docs.cdp.coinbase.com/agentkit) · [SERV Reasoning](https://docs.openserv.ai) · [IXS Finance](https://www.ixs.finance)*

</div>
