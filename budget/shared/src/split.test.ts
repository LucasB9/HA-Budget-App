import { describe, expect, it } from 'vitest';
import { allocate, computeShares, ratioFromWeights, resolveMonthWeights } from './split.js';

const people = ['p1', 'p2'] as const;
const sum = (shares: Record<string, number>): number => Object.values(shares).reduce((a, b) => a + b, 0);

describe('allocate', () => {
  it('splits proportionally to weights', () => {
    const shares = allocate(10000, { p1: 5300, p2: 2100 }, people, 'p1');
    expect(sum(shares)).toBe(10000);
    // floor(7162.16) + floor(2837.84) = 9999: the leftover cent goes to the payer
    expect(shares).toEqual({ p1: 7163, p2: 2837 });
    expect(allocate(10000, { p1: 5300, p2: 2100 }, people, 'p2')).toEqual({ p1: 7162, p2: 2838 });
  });

  it('gives the leftover cent to the payer', () => {
    const asP1 = allocate(100, { p1: 1, p2: 1 }, people, 'p1');
    expect(asP1).toEqual({ p1: 50, p2: 50 });

    const odd = allocate(101, { p1: 1, p2: 1 }, people, 'p2');
    expect(odd).toEqual({ p1: 50, p2: 51 });
    const odd2 = allocate(101, { p1: 1, p2: 1 }, people, 'p1');
    expect(odd2).toEqual({ p1: 51, p2: 50 });
  });

  it('always sums exactly to the amount', () => {
    for (let amount = 1; amount < 500; amount += 7) {
      for (const payer of people) {
        const shares = allocate(amount, { p1: 5300, p2: 2100 }, people, payer);
        expect(sum(shares)).toBe(amount);
      }
    }
  });

  it('handles a zero-weight person', () => {
    expect(allocate(999, { p1: 1, p2: 0 }, people, 'p2')).toEqual({ p1: 999, p2: 0 });
  });

  it('rejects non-integer amounts and empty weights', () => {
    expect(() => allocate(10.5, { p1: 1, p2: 1 }, people, 'p1')).toThrow();
    expect(() => allocate(10, { p1: 0, p2: 0 }, people, 'p1')).toThrow();
  });
});

describe('computeShares', () => {
  it('income mode uses the frozen weights', () => {
    const shares = computeShares({
      mode: 'income',
      amountCents: 7400,
      payerId: 'p1',
      personIds: people,
      incomeWeights: { p1: 530000, p2: 210000 },
    });
    expect(shares).toEqual({ p1: 5300, p2: 2100 });
  });

  it('income mode falls back to equal without usable weights', () => {
    const shares = computeShares({
      mode: 'income',
      amountCents: 1000,
      payerId: 'p1',
      personIds: people,
      incomeWeights: { p1: 0, p2: 0 },
    });
    expect(shares).toEqual({ p1: 500, p2: 500 });
  });

  it('equal mode splits 50/50', () => {
    expect(computeShares({ mode: 'equal', amountCents: 1001, payerId: 'p2', personIds: people })).toEqual({
      p1: 500,
      p2: 501,
    });
  });

  it('single mode puts everything on one person', () => {
    expect(
      computeShares({ mode: 'single', amountCents: 4200, payerId: 'p1', personIds: people, singleId: 'p2' }),
    ).toEqual({ p1: 0, p2: 4200 });
  });

  it('single mode requires a valid person', () => {
    expect(() =>
      computeShares({ mode: 'single', amountCents: 1, payerId: 'p1', personIds: people, singleId: 'nope' }),
    ).toThrow();
  });

  it('custom mode uses basis points', () => {
    expect(
      computeShares({
        mode: 'custom',
        amountCents: 1000,
        payerId: 'p1',
        personIds: people,
        customBp: { p1: 7000, p2: 3000 },
      }),
    ).toEqual({ p1: 700, p2: 300 });
  });

  it('custom mode rejects percentages not summing to 100%', () => {
    expect(() =>
      computeShares({
        mode: 'custom',
        amountCents: 1000,
        payerId: 'p1',
        personIds: people,
        customBp: { p1: 5000, p2: 4000 },
      }),
    ).toThrow(/100%/);
  });
});

describe('month weights', () => {
  it('uses the month incomes when present', () => {
    expect(resolveMonthWeights({ p1: 530000, p2: 210000 }, people)).toEqual({ p1: 530000, p2: 210000 });
  });

  it('falls back to the previous month when no income is entered', () => {
    expect(resolveMonthWeights({ p1: 0, p2: 0 }, people, { p1: 3, p2: 1 })).toEqual({ p1: 3, p2: 1 });
  });

  it('falls back to an equal split when nothing is known', () => {
    expect(resolveMonthWeights({}, people, null)).toEqual({ p1: 1, p2: 1 });
  });

  it('computes the displayed ratio', () => {
    const ratio = ratioFromWeights({ p1: 5300, p2: 2100 }, people);
    expect(ratio.p1).toBeCloseTo(0.716, 3);
    expect(ratio.p2).toBeCloseTo(0.284, 3);
    expect((ratio.p1 ?? 0) + (ratio.p2 ?? 0)).toBeCloseTo(1, 10);
  });
});
