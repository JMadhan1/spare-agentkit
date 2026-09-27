import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAddress } from "viem";
import { config } from "./config.js";
import { assessVaults, type VaultAssessment } from "./ixs.js";
import { applyPolicy, type PolicyResult } from "./policy.js";
import { decideRoundup, decideSweep, type RoundupDecision, type SweepDecision } from "./serv.js";
import { wallet } from "./wallet.js";

export interface PaymentRequest {
  to?: string;
  merchant: string;
  memo?: string;
  amount: number;
  source?: string;
}

export interface PaymentRecord {
  id: string;
  at: string;
  merchant: string;
  memo: string;
  to: string;
  amount: number;
  source: string;
  status: "deciding" | "paying" | "done" | "held" | "failed";
  decision?: RoundupDecision;
  policy?: PolicyResult;
  paymentTx?: string;
  roundupTx?: string;
  error?: string;
}

export interface SweepRecord {
  id: string;
  at: string;
  stash: number;
  status: "assessing" | "done" | "failed";
  vaults?: VaultAssessment[];
  decision?: SweepDecision;
  error?: string;
}

interface State {
  rules: string;
  day: string;
  roundedUpToday: number;
  payments: PaymentRecord[];
  sweeps: SweepRecord[];
}

const DATA = "data/state.json";
const today = () => new Date().toISOString().slice(0, 10);

export const DEFAULT_RULES = `Round up every payment my agent makes for AI inference, data APIs and compute.
Boost 2x on food, drinks and shopping.
Never round up rent or bills.`;

function load(): State {
  try {
    return JSON.parse(readFileSync(DATA, "utf8"));
  } catch {
    return { rules: DEFAULT_RULES, day: today(), roundedUpToday: 0, payments: [], sweeps: [] };
  }
}

class Engine extends EventEmitter {
  state: State = load();
  private sweeping = false;

  private save() {
    mkdirSync("data", { recursive: true });
    writeFileSync(DATA, JSON.stringify(this.state, null, 2));
  }

  private emitUpdate(kind: string, record: PaymentRecord | SweepRecord) {
    this.save();
    this.emit("update", { kind, record });
  }

  setRules(rules: string) {
    this.state.rules = rules.slice(0, 2000);
    this.save();
  }

  async pay(req: PaymentRequest): Promise<PaymentRecord> {
    if (this.state.day !== today()) {
      this.state.day = today();
      this.state.roundedUpToday = 0;
    }
    const amount = Math.round(Number(req.amount) * 1e6) / 1e6;
    const to = req.to || config.merchantAddress;
    if (!(amount > 0) || amount > 1000) throw new Error("amount must be between 0 and 1000 USDC");
    if (!isAddress(to)) throw new Error("invalid recipient address");

    const rec: PaymentRecord = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      merchant: String(req.merchant || "Unknown merchant").slice(0, 80),
      memo: String(req.memo ?? "").slice(0, 500),
      to,
      amount,
      source: String(req.source || "owner").slice(0, 60),
      status: "deciding",
    };
    this.state.payments.unshift(rec);
    this.emitUpdate("payment", rec);

    try {
      const balance = await wallet.usdcBalance(wallet.address);
      if (balance < amount) throw new Error(`agent wallet has ${balance.toFixed(2)} USDC, needs ${amount}`);

      rec.decision = await decideRoundup({
        merchant: rec.merchant,
        memo: rec.memo,
        amount,
        rules: this.state.rules,
        source: rec.source,
      });
      if (rec.decision.blocked || rec.decision.suspicious) {
        rec.status = "held";
        this.emitUpdate("payment", rec);
        return rec;
      }

      rec.policy = applyPolicy({
        amount,
        action: rec.decision.action,
        multiplier: rec.decision.multiplier,
        walletBalance: balance,
        roundedUpToday: this.state.roundedUpToday,
      });
      rec.status = "paying";
      this.emitUpdate("payment", rec);

      rec.paymentTx = await wallet.transferUsdc(to as `0x${string}`, amount);
      this.emitUpdate("payment", rec);
      if (rec.policy.roundup > 0) {
        rec.roundupTx = await wallet.transferUsdc(config.stashAddress as `0x${string}`, rec.policy.roundup);
        this.state.roundedUpToday = Math.round((this.state.roundedUpToday + rec.policy.roundup) * 100) / 100;
      }
      rec.status = "done";
      this.emitUpdate("payment", rec);
      void this.maybeSweep();
      return rec;
    } catch (e) {
      rec.status = "failed";
      rec.error = e instanceof Error ? e.message : String(e);
      this.emitUpdate("payment", rec);
      return rec;
    }
  }

  async maybeSweep(force = false) {
    if (this.sweeping) return;
    const stash = await wallet.usdcBalance(config.stashAddress as `0x${string}`);
    if (!force && stash < config.caps.sweepThreshold) return;
    const last = this.state.sweeps[0];
    if (!force && last && Date.now() - Date.parse(last.at) < 5 * 60_000) return;
    await this.sweep(stash);
  }

  // Spare never holds the stash key: a sweep ends with a decision and IXS-built calldata for the owner to sign.
  async sweep(stash?: number): Promise<SweepRecord> {
    this.sweeping = true;
    const balance = stash ?? (await wallet.usdcBalance(config.stashAddress as `0x${string}`));
    const rec: SweepRecord = { id: crypto.randomUUID(), at: new Date().toISOString(), stash: balance, status: "assessing" };
    this.state.sweeps.unshift(rec);
    this.emitUpdate("sweep", rec);
    try {
      rec.vaults = await assessVaults(config.stashAddress, Math.max(balance, 0.01));
      this.emitUpdate("sweep", rec);
      rec.decision = await decideSweep({ stash: balance, stashNetwork: config.networkId, vaults: rec.vaults });
      rec.status = "done";
    } catch (e) {
      rec.status = "failed";
      rec.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.sweeping = false;
    }
    this.emitUpdate("sweep", rec);
    return rec;
  }
}

export const engine = new Engine();
