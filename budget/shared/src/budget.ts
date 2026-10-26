import type { Cents } from './money.js';
import { daysInMonth } from './month.js';

export type CategoryKind = 'fixed' | 'variable' | 'provision' | 'system';
export type BudgetStatus = 'ok' | 'warn' | 'over';
export type CarryMode = 'none' | 'positive' | 'signed';

export const WARN_THRESHOLD = 0.8;
/** Ratios are capped so they always survive JSON serialization. */
export const MAX_RATIO = 10;

/** Provisions carry their balance (even negative); rollover categories carry only unspent money. */
export function carryModeFor(kind: CategoryKind, rollover: boolean): CarryMode {
  if (kind === 'provision') return 'signed';
  return rollover ? 'positive' : 'none';
}

export interface MonthEnvelope {
  /** Fixed and provision envelopes are expected to be used up: they only alert when exceeded. */
  kind?: CategoryKind;
  planned: Cents;
  transfersIn: Cents;
  transfersOut: Cents;
  spent: Cents;
  carryIn: Cents;
}

export interface EnvelopeResult {
  /** planned ± transfers, before the carry from previous months */
  base: Cents;
  /** base + carryIn */
  effective: Cents;
  remaining: Cents;
  ratio: number;
  status: BudgetStatus;
}

export function computeEnvelope(input: MonthEnvelope): EnvelopeResult {
  const base = input.planned + input.transfersIn - input.transfersOut;
  const effective = base + input.carryIn;
  const remaining = effective - input.spent;
  const ratio = effective > 0 ? Math.min(MAX_RATIO, input.spent / effective) : input.spent > 0 ? MAX_RATIO : 0;
  return { base, effective, remaining, ratio, status: statusFor(ratio, input.spent, input.kind) };
}

export function statusFor(ratio: number, spent: Cents, kind?: CategoryKind): BudgetStatus {
  if (spent <= 0) return 'ok';
  if (kind === 'fixed' || kind === 'provision') return ratio > 1 ? 'over' : 'ok';
  if (ratio >= 1) return 'over';
  if (ratio > WARN_THRESHOLD) return 'warn';
  return 'ok';
}

export interface CarryStep {
  base: Cents;
  spent: Cents;
}

/**
 * Carry flowing into the month that follows `history` (ordered oldest to newest).
 * Each month's leftover is `base + carryIn - spent`.
 */
export function carryAfter(history: readonly CarryStep[], mode: CarryMode): Cents {
  if (mode === 'none') return 0;
  let carry = 0;
  for (const step of history) {
    const left = step.base + carry - step.spent;
    carry = mode === 'positive' ? Math.max(0, left) : left;
  }
  return carry;
}

/** Carry into each month of `history`, aligned by index. */
export function carrySeries(history: readonly CarryStep[], mode: CarryMode): Cents[] {
  const out: Cents[] = [];
  let carry = 0;
  for (const step of history) {
    out.push(mode === 'none' ? 0 : carry);
    const left = step.base + carry - step.spent;
    carry = mode === 'none' ? 0 : mode === 'positive' ? Math.max(0, left) : left;
  }
  return out;
}

export interface ProjectionInput {
  kind: CategoryKind;
  month: string;
  /** Day of month of "today", or null when the month is entirely past/future. */
  todayDay: number | null;
  /** 'past' months project to what was spent, 'future' months to the budget. */
  position: 'past' | 'current' | 'future';
  spent: Cents;
  effective: Cents;
}

/** Minimum elapsed days used to extrapolate, to keep a big early purchase from exploding the projection. */
export const MIN_PROJECTION_DAYS = 5;

export function projectEndOfMonth(input: ProjectionInput): Cents {
  if (input.position === 'past') return input.spent;
  if (input.position === 'future') return Math.max(input.spent, input.effective);
  if (input.kind === 'fixed') return Math.max(input.spent, input.effective);
  if (input.kind === 'provision' || input.kind === 'system') return input.spent;
  const day = Math.max(MIN_PROJECTION_DAYS, input.todayDay ?? daysInMonth(input.month));
  const total = daysInMonth(input.month);
  return Math.max(input.spent, Math.round((input.spent * total) / day));
}
