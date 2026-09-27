import { config } from "./config.js";

export type RoundupAction = "skip" | "roundup" | "boost";

export interface PolicyInput {
  amount: number;
  action: RoundupAction;
  multiplier: number;
  walletBalance: number;
  roundedUpToday: number;
}

export interface PolicyResult {
  unit: number;
  base: number;
  multiplier: number;
  roundup: number;
  clampedBy: string[];
}

const cents = (n: number) => Math.round(n * 100) / 100;

// Micropayments (typical x402 API calls) round to the next dime; everything else to the next dollar.
export function roundupUnit(amount: number): number {
  return amount < 1 ? 0.1 : 1;
}

export function applyPolicy(p: PolicyInput): PolicyResult {
  const unit = roundupUnit(p.amount);
  const base = cents(Math.ceil(cents(p.amount) / unit - 1e-9) * unit - p.amount);
  const clampedBy: string[] = [];

  if (p.action === "skip") return { unit, base, multiplier: 0, roundup: 0, clampedBy };

  let multiplier = p.action === "roundup" ? 1 : Math.min(Math.max(Math.round(p.multiplier), 1), 3);
  if (p.action === "boost" && multiplier !== p.multiplier) clampedBy.push("multiplier clamped to 1-3x");

  let roundup = cents(base * multiplier);

  if (roundup > config.caps.maxRoundupPerPayment) {
    roundup = config.caps.maxRoundupPerPayment;
    clampedBy.push(`per-payment cap $${config.caps.maxRoundupPerPayment}`);
  }
  const dailyLeft = cents(config.caps.dailyRoundupCap - p.roundedUpToday);
  if (roundup > dailyLeft) {
    roundup = Math.max(dailyLeft, 0);
    clampedBy.push(`daily cap $${config.caps.dailyRoundupCap}`);
  }
  const spendable = cents(p.walletBalance - p.amount - config.caps.walletFloor);
  if (roundup > spendable) {
    roundup = Math.max(spendable, 0);
    clampedBy.push(`wallet floor $${config.caps.walletFloor}`);
  }

  if (roundup === 0) multiplier = 0;
  return { unit, base, multiplier, roundup: cents(roundup), clampedBy };
}
