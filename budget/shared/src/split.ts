import type { Cents } from './money.js';

export type PersonId = string;
export type SplitMode = 'income' | 'equal' | 'single' | 'custom';

export const SPLIT_MODES: readonly SplitMode[] = ['income', 'equal', 'single', 'custom'];

export interface SplitRequest {
  mode: SplitMode;
  amountCents: Cents;
  payerId: PersonId;
  personIds: readonly PersonId[];
  /** Frozen income weights of the expense's month (mode `income`). */
  incomeWeights?: Readonly<Record<PersonId, number>>;
  /** Person who bears 100% of the expense (mode `single`). */
  singleId?: PersonId;
  /** Percentages in basis points, summing to 10000 (mode `custom`). */
  customBp?: Readonly<Record<PersonId, number>>;
}

/**
 * Splits `amountCents` proportionally to `weights`. Each share is floored, and the
 * leftover cents (always fewer than the number of people) go to the payer so the
 * shares sum exactly to the amount.
 */
export function allocate(
  amountCents: Cents,
  weights: Readonly<Record<PersonId, number>>,
  personIds: readonly PersonId[],
  payerId: PersonId,
): Record<PersonId, Cents> {
  if (!Number.isInteger(amountCents)) throw new Error('amountCents must be an integer');
  const total = personIds.reduce((sum, id) => sum + (weights[id] ?? 0), 0);
  if (total <= 0) throw new Error('weights must have a positive total');
  const shares: Record<PersonId, Cents> = {};
  let assigned = 0;
  for (const id of personIds) {
    const weight = weights[id] ?? 0;
    const share = Math.floor((amountCents * weight) / total);
    shares[id] = share;
    assigned += share;
  }
  const leftover = amountCents - assigned;
  if (leftover !== 0) {
    const target = personIds.includes(payerId) ? payerId : (personIds[0] as PersonId);
    shares[target] = (shares[target] ?? 0) + leftover;
  }
  return shares;
}

export function computeShares(req: SplitRequest): Record<PersonId, Cents> {
  const { mode, amountCents, payerId, personIds } = req;
  switch (mode) {
    case 'equal': {
      const weights = Object.fromEntries(personIds.map((id) => [id, 1]));
      return allocate(amountCents, weights, personIds, payerId);
    }
    case 'single': {
      if (!req.singleId || !personIds.includes(req.singleId)) {
        throw new Error('single split requires a valid singleId');
      }
      return Object.fromEntries(personIds.map((id) => [id, id === req.singleId ? amountCents : 0]));
    }
    case 'custom': {
      const bp = req.customBp;
      if (!bp) throw new Error('custom split requires customBp');
      const total = personIds.reduce((sum, id) => sum + (bp[id] ?? 0), 0);
      if (total !== 10000) throw new Error('custom percentages must sum to 100%');
      return allocate(amountCents, bp, personIds, payerId);
    }
    case 'income': {
      const weights = req.incomeWeights;
      const total = weights ? personIds.reduce((sum, id) => sum + (weights[id] ?? 0), 0) : 0;
      if (!weights || total <= 0) return computeShares({ ...req, mode: 'equal' });
      return allocate(amountCents, weights, personIds, payerId);
    }
  }
}

/** Share of the total carried by each person, as fractions summing to 1. */
export function ratioFromWeights(
  weights: Readonly<Record<PersonId, number>>,
  personIds: readonly PersonId[],
): Record<PersonId, number> {
  const total = personIds.reduce((sum, id) => sum + (weights[id] ?? 0), 0);
  if (total <= 0) return Object.fromEntries(personIds.map((id) => [id, 1 / personIds.length]));
  return Object.fromEntries(personIds.map((id) => [id, (weights[id] ?? 0) / total]));
}

/**
 * Picks the weights to freeze for a month: its own incomes when the total is positive,
 * otherwise the previous month's weights, otherwise an equal split.
 */
export function resolveMonthWeights(
  incomes: Readonly<Record<PersonId, Cents>>,
  personIds: readonly PersonId[],
  previousWeights?: Readonly<Record<PersonId, number>> | null,
): Record<PersonId, number> {
  const total = personIds.reduce((sum, id) => sum + Math.max(0, incomes[id] ?? 0), 0);
  if (total > 0) return Object.fromEntries(personIds.map((id) => [id, Math.max(0, incomes[id] ?? 0)]));
  const prevTotal = previousWeights
    ? personIds.reduce((sum, id) => sum + (previousWeights[id] ?? 0), 0)
    : 0;
  if (previousWeights && prevTotal > 0) {
    return Object.fromEntries(personIds.map((id) => [id, previousWeights[id] ?? 0]));
  }
  return Object.fromEntries(personIds.map((id) => [id, 1]));
}
