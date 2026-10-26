import { describe, expect, it } from 'vitest';
import { computeNet, debtFromNet } from './balance.js';

const people = ['p1', 'p2'] as const;

describe('computeNet', () => {
  it('credits the payer for the part of the expense others bear', () => {
    const net = computeNet(people, [{ payerId: 'p1', amountCents: 10000, shares: { p1: 7471, p2: 2529 } }], []);
    expect(net).toEqual({ p1: 2529, p2: -2529 });
  });

  it('ignores personal expenses paid by the person who bears them', () => {
    const net = computeNet(people, [{ payerId: 'p1', amountCents: 5000, shares: { p1: 5000, p2: 0 } }], []);
    expect(net).toEqual({ p1: 0, p2: 0 });
  });

  it('charges the other person when someone pays for another', () => {
    const net = computeNet(people, [{ payerId: 'p1', amountCents: 5000, shares: { p1: 0, p2: 5000 } }], []);
    expect(net).toEqual({ p1: 5000, p2: -5000 });
  });

  it('nets expenses paid by both sides', () => {
    const net = computeNet(
      people,
      [
        { payerId: 'p1', amountCents: 10000, shares: { p1: 5000, p2: 5000 } },
        { payerId: 'p2', amountCents: 3000, shares: { p1: 1500, p2: 1500 } },
      ],
      [],
    );
    expect(net).toEqual({ p1: 3500, p2: -3500 });
  });

  it('applies settlements', () => {
    const expenses = [{ payerId: 'p1', amountCents: 10000, shares: { p1: 5000, p2: 5000 } }];
    const partial = computeNet(people, expenses, [{ fromId: 'p2', toId: 'p1', amountCents: 2000 }]);
    expect(partial).toEqual({ p1: 3000, p2: -3000 });
    const full = computeNet(people, expenses, [{ fromId: 'p2', toId: 'p1', amountCents: 5000 }]);
    expect(full).toEqual({ p1: 0, p2: 0 });
  });

  it('always sums to zero', () => {
    const net = computeNet(
      people,
      [
        { payerId: 'p1', amountCents: 12345, shares: { p1: 9223, p2: 3122 } },
        { payerId: 'p2', amountCents: 999, shares: { p1: 250, p2: 749 } },
      ],
      [{ fromId: 'p2', toId: 'p1', amountCents: 400 }],
    );
    expect((net.p1 ?? 0) + (net.p2 ?? 0)).toBe(0);
  });
});

describe('debtFromNet', () => {
  it('returns who owes whom', () => {
    expect(debtFromNet({ p1: 2529, p2: -2529 })).toEqual({ debtorId: 'p2', creditorId: 'p1', amountCents: 2529 });
    expect(debtFromNet({ p1: -10, p2: 10 })).toEqual({ debtorId: 'p1', creditorId: 'p2', amountCents: 10 });
  });

  it('returns null when settled', () => {
    expect(debtFromNet({ p1: 0, p2: 0 })).toBeNull();
  });
});
