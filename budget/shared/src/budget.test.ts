import { describe, expect, it } from 'vitest';
import {
  carryAfter,
  carryModeFor,
  carrySeries,
  computeEnvelope,
  projectEndOfMonth,
  statusFor,
} from './budget.js';

describe('computeEnvelope', () => {
  it('applies transfers and carry to the effective budget', () => {
    const r = computeEnvelope({ planned: 10000, transfersIn: 2000, transfersOut: 500, spent: 6000, carryIn: 1000 });
    expect(r.base).toBe(11500);
    expect(r.effective).toBe(12500);
    expect(r.remaining).toBe(6500);
    expect(r.ratio).toBeCloseTo(0.48);
    expect(r.status).toBe('ok');
  });

  it('flags warn above 80% and over at 100%', () => {
    expect(statusFor(0.8, 80)).toBe('ok');
    expect(statusFor(0.81, 81)).toBe('warn');
    expect(statusFor(1, 100)).toBe('over');
    expect(statusFor(1.4, 140)).toBe('over');
  });

  it('does not alert fixed or provision envelopes that are used up exactly', () => {
    expect(statusFor(1, 100, 'fixed')).toBe('ok');
    expect(statusFor(0.9, 90, 'provision')).toBe('ok');
    expect(statusFor(1.01, 101, 'fixed')).toBe('over');
    const r = computeEnvelope({ kind: 'fixed', planned: 90000, transfersIn: 0, transfersOut: 0, spent: 90000, carryIn: 0 });
    expect(r.status).toBe('ok');
  });

  it('keeps ratio finite when the budget is zero', () => {
    const r = computeEnvelope({ planned: 0, transfersIn: 0, transfersOut: 0, spent: 500, carryIn: 0 });
    expect(Number.isFinite(r.ratio)).toBe(true);
    expect(r.status).toBe('over');
    expect(r.remaining).toBe(-500);
  });

  it('is fine with nothing planned and nothing spent', () => {
    const r = computeEnvelope({ planned: 0, transfersIn: 0, transfersOut: 0, spent: 0, carryIn: 0 });
    expect(r.ratio).toBe(0);
    expect(r.status).toBe('ok');
  });

  it('lets transfers reduce a budget below what was spent', () => {
    const r = computeEnvelope({ planned: 10000, transfersIn: 0, transfersOut: 9000, spent: 4000, carryIn: 0 });
    expect(r.effective).toBe(1000);
    expect(r.status).toBe('over');
  });
});

describe('carry', () => {
  const history = [
    { base: 10000, spent: 4000 },
    { base: 10000, spent: 12000 },
    { base: 10000, spent: 3000 },
  ];

  it('does nothing without rollover', () => {
    expect(carryAfter(history, 'none')).toBe(0);
    expect(carrySeries(history, 'none')).toEqual([0, 0, 0]);
  });

  it('carries only unspent money in positive mode', () => {
    expect(carrySeries(history, 'positive')).toEqual([0, 6000, 4000]);
    expect(carryAfter(history, 'positive')).toBe(11000);
  });

  it('lets provisions go negative in signed mode', () => {
    const provision = [
      { base: 10000, spent: 0 },
      { base: 10000, spent: 35000 },
      { base: 10000, spent: 0 },
    ];
    expect(carrySeries(provision, 'signed')).toEqual([0, 10000, -15000]);
    expect(carryAfter(provision, 'signed')).toBe(-5000);
  });

  it('accumulates provisions month after month until spent', () => {
    const noel = Array.from({ length: 11 }, () => ({ base: 10000, spent: 0 }));
    expect(carryAfter(noel, 'signed')).toBe(110000);
  });

  it('maps category kinds to carry modes', () => {
    expect(carryModeFor('provision', false)).toBe('signed');
    expect(carryModeFor('variable', true)).toBe('positive');
    expect(carryModeFor('variable', false)).toBe('none');
    expect(carryModeFor('fixed', false)).toBe('none');
  });
});

describe('projectEndOfMonth', () => {
  const base = { month: '2026-10', effective: 60000, kind: 'variable' as const };

  it('uses what was spent for past months and the budget for future ones', () => {
    expect(projectEndOfMonth({ ...base, position: 'past', todayDay: null, spent: 5000 })).toBe(5000);
    expect(projectEndOfMonth({ ...base, position: 'future', todayDay: null, spent: 0 })).toBe(60000);
  });

  it('extrapolates linearly for the current month', () => {
    expect(projectEndOfMonth({ ...base, position: 'current', todayDay: 10, spent: 20000 })).toBe(62000);
  });

  it('does not explode early in the month', () => {
    const p = projectEndOfMonth({ ...base, position: 'current', todayDay: 1, spent: 10000 });
    expect(p).toBe(62000); // 10000 * 31 / 5
  });

  it('projects fixed categories to their budget and provisions to what was spent', () => {
    expect(projectEndOfMonth({ ...base, kind: 'fixed', position: 'current', todayDay: 3, spent: 0 })).toBe(60000);
    expect(projectEndOfMonth({ ...base, kind: 'provision', position: 'current', todayDay: 3, spent: 0 })).toBe(0);
  });
});
