import type { Cents } from './money.js';
import type { PersonId } from './split.js';

export interface BalanceExpense {
  payerId: PersonId;
  amountCents: Cents;
  shares: Readonly<Record<PersonId, Cents>>;
}

export interface BalanceSettlement {
  fromId: PersonId;
  toId: PersonId;
  amountCents: Cents;
}

export interface Debt {
  debtorId: PersonId;
  creditorId: PersonId;
  amountCents: Cents;
}

/**
 * Net position per person. Positive means the person is owed money by the others,
 * negative means they owe. A settlement from X to Y raises X's net and lowers Y's.
 */
export function computeNet(
  personIds: readonly PersonId[],
  expenses: readonly BalanceExpense[],
  settlements: readonly BalanceSettlement[],
): Record<PersonId, Cents> {
  const net: Record<PersonId, Cents> = Object.fromEntries(personIds.map((id) => [id, 0]));
  const add = (id: PersonId, delta: Cents): void => {
    net[id] = (net[id] ?? 0) + delta;
  };
  for (const e of expenses) {
    add(e.payerId, e.amountCents);
    for (const id of personIds) add(id, -(e.shares[id] ?? 0));
  }
  for (const s of settlements) {
    add(s.fromId, s.amountCents);
    add(s.toId, -s.amountCents);
  }
  return net;
}

/** Collapses a two-person net position into a single debt, or null when settled. */
export function debtFromNet(net: Readonly<Record<PersonId, Cents>>): Debt | null {
  const entries = Object.entries(net);
  const debtor = entries.reduce<[string, number] | null>(
    (min, e) => (min === null || e[1] < min[1] ? e : min),
    null,
  );
  const creditor = entries.reduce<[string, number] | null>(
    (max, e) => (max === null || e[1] > max[1] ? e : max),
    null,
  );
  if (!debtor || !creditor || debtor[1] >= 0) return null;
  return { debtorId: debtor[0], creditorId: creditor[0], amountCents: Math.min(-debtor[1], creditor[1]) };
}
