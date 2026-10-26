import { describe, expect, it } from 'vitest';
import type { ApiError, DashboardDto, SavingsOverviewDto } from '@budget/shared';
import { api, createTestEnv, seedExample, type TestEnv } from './test-helpers.js';

// The example seed creates two accounts: "Livret A" (goal 5000 euros) and "PEA".

async function setup(now?: string): Promise<TestEnv> {
  const env = createTestEnv(now ? { now } : {});
  await seedExample(env);
  return env;
}

const overview = async (env: TestEnv): Promise<SavingsOverviewDto> => (await api<SavingsOverviewDto>(env, 'GET', '/api/savings')).body;

async function accountId(env: TestEnv, name: string): Promise<string> {
  const found = (await overview(env)).accounts.find((a) => a.name === name);
  if (!found) throw new Error(`no account ${name}`);
  return found.id;
}

async function contribute(env: TestEnv, name: string, month: string, contributionCents: number, balanceCents: number | null = null): Promise<void> {
  const res = await api(env, 'PUT', '/api/savings/entries', { accountId: await accountId(env, name), month, contributionCents, balanceCents });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
}

describe('savings accounts', () => {
  it('loads the accounts from the seed', async () => {
    const env = await setup();
    const { accounts } = await overview(env);
    expect(accounts.map((a) => [a.name, a.goalCents])).toEqual([
      ['Livret A', 500000],
      ['PEA', null],
    ]);
  });

  it('creates, edits and archives an account', async () => {
    const env = await setup();
    const created = await api<{ id: string }>(env, 'POST', '/api/savings/accounts', { name: 'Crypto', kind: 'Crypto' });
    expect(created.status).toBe(201);
    expect((await api(env, 'PATCH', `/api/savings/accounts/${created.body.id}`, { name: 'Bitcoin', goalCents: 100000, goalDate: '2027-12-31' })).status).toBe(200);
    expect((await api(env, 'PATCH', `/api/savings/accounts/${created.body.id}`, { archived: true })).status).toBe(200);
    const acc = (await overview(env)).accounts.find((a) => a.id === created.body.id);
    expect(acc).toMatchObject({ name: 'Bitcoin', goalCents: 100000, goalDate: '2027-12-31', archived: true });
  });

  it('rejects an invalid account', async () => {
    const env = await setup();
    expect((await api(env, 'POST', '/api/savings/accounts', { name: '' })).status).toBe(400);
    expect((await api(env, 'PATCH', '/api/savings/accounts/nope', { name: 'x' })).status).toBe(404);
  });
});

describe('monthly contributions', () => {
  it('accumulates contributions per account and in total', async () => {
    const env = await setup();
    await contribute(env, 'Livret A', '2026-08', 20000);
    await contribute(env, 'Livret A', '2026-09', 30000);
    await contribute(env, 'PEA', '2026-09', 50000);
    await contribute(env, 'Livret A', '2026-10', 10000);

    const o = await overview(env);
    expect(o.series.map((p) => [p.month, p.contributionCents, p.cumulativeCents])).toEqual([
      ['2026-08', 20000, 20000],
      ['2026-09', 80000, 100000],
      ['2026-10', 10000, 110000],
    ]);
    const livret = await accountId(env, 'Livret A');
    expect(o.series.at(-1)?.perAccount[livret]).toBe(60000);
    expect(o.accounts.find((a) => a.id === livret)?.contributionsCents).toBe(60000);
  });

  it('fills months without entries so charts have no gaps', async () => {
    const env = await setup();
    await contribute(env, 'Livret A', '2026-07', 10000);
    await contribute(env, 'Livret A', '2026-10', 10000);
    const o = await overview(env);
    expect(o.series.map((p) => p.month)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(o.series[1]).toMatchObject({ contributionCents: 0, cumulativeCents: 10000 });
  });

  it('replaces the entry of an account and month instead of duplicating it', async () => {
    const env = await setup();
    await contribute(env, 'Livret A', '2026-10', 10000);
    await contribute(env, 'Livret A', '2026-10', 25000);
    const o = await overview(env);
    expect(o.entries).toHaveLength(1);
    expect(o.series.at(-1)?.cumulativeCents).toBe(25000);
  });

  it('removes an entry that is emptied', async () => {
    const env = await setup();
    await contribute(env, 'Livret A', '2026-10', 10000);
    await contribute(env, 'Livret A', '2026-10', 0, null);
    expect((await overview(env)).entries).toHaveLength(0);
  });

  it('treats negative contributions as withdrawals', async () => {
    const env = await setup();
    await contribute(env, 'Livret A', '2026-09', 50000);
    await contribute(env, 'Livret A', '2026-10', -20000);
    expect((await overview(env)).series.at(-1)?.cumulativeCents).toBe(30000);
  });

  it('refuses entries for an archived or unknown account', async () => {
    const env = await setup();
    const id = await accountId(env, 'PEA');
    await api(env, 'PATCH', `/api/savings/accounts/${id}`, { archived: true });
    const archived = await api<ApiError>(env, 'PUT', '/api/savings/entries', { accountId: id, month: '2026-10', contributionCents: 100 });
    expect(archived.body.error).toBe('account_archived');
    const unknown = await api(env, 'PUT', '/api/savings/entries', { accountId: 'nope', month: '2026-10', contributionCents: 100 });
    expect(unknown.status).toBe(404);
    const badMonth = await api(env, 'PUT', '/api/savings/entries', { accountId: id, month: 'oct', contributionCents: 100 });
    expect(badMonth.status).toBe(400);
  });
});

describe('balances, goals and savings rate', () => {
  it('uses the latest end-of-month balance as the account value, carried forward in the series', async () => {
    const env = await setup();
    await contribute(env, 'Livret A', '2026-08', 100000, 100500);
    await contribute(env, 'Livret A', '2026-09', 100000);
    await contribute(env, 'Livret A', '2026-10', 100000, 301000);
    const o = await overview(env);
    expect(o.series.map((p) => p.balanceCents)).toEqual([100500, 100500, 301000]);
    const livret = o.accounts.find((a) => a.name === 'Livret A');
    expect(livret).toMatchObject({ latestBalanceCents: 301000, latestBalanceMonth: '2026-10', currentCents: 301000 });
    expect(livret?.progress).toBeCloseTo(301000 / 500000);
  });

  it('values an account without snapshot at its contributions in the total value', async () => {
    const env = await setup();
    await contribute(env, 'Livret A', '2026-09', 100000, 104000);
    await contribute(env, 'PEA', '2026-09', 50000); // no snapshot: counted at what was put in
    expect((await overview(env)).series.at(-1)?.balanceCents).toBe(154000);
  });

  it('falls back to cumulative contributions when there is no snapshot', async () => {
    const env = await setup();
    await contribute(env, 'Livret A', '2026-09', 100000);
    await contribute(env, 'Livret A', '2026-10', 50000);
    const livret = (await overview(env)).accounts.find((a) => a.name === 'Livret A');
    expect(livret?.currentCents).toBe(150000);
    expect(livret?.progress).toBeCloseTo(0.3);
    expect((await overview(env)).series.every((p) => p.balanceCents === null)).toBe(true);
  });

  it('computes the savings rate against that month income and the planned amount', async () => {
    const env = await setup();
    await contribute(env, 'Livret A', '2026-10', 100000);
    await contribute(env, 'PEA', '2026-10', 60000);
    const stat = (await overview(env)).monthStats.at(-1);
    // income 4000 euros, planned expenses 2410 euros => 1590 euros meant to be set aside
    expect(stat).toMatchObject({ month: '2026-10', incomeCents: 400000, plannedCents: 159000, contributionCents: 160000 });
    expect(stat?.rate).toBeCloseTo(0.4);
  });

  it('shows the month contributions and savings rate on the dashboard', async () => {
    const env = await setup();
    await contribute(env, 'Livret A', '2026-10', 100000);
    const d = (await api<DashboardDto>(env, 'GET', '/api/months/2026-10/dashboard')).body;
    expect(d.totals.savingsContributions).toBe(100000);
    expect(d.totals.savingsRate).toBeCloseTo(0.25);
  });

  it('has no savings rate for a month without income', async () => {
    const env = createTestEnv();
    const seed = { version: 1, people: [{ name: 'A', monthlyIncome: 0 }, { name: 'B', monthlyIncome: 0 }], groups: [], savingsAccounts: [{ name: 'Livret' }] };
    expect((await api(env, 'POST', '/api/setup/seed', seed)).status).toBe(201);
    await contribute(env, 'Livret', '2026-10', 1000);
    expect((await overview(env)).monthStats.at(-1)?.rate).toBeNull();
  });

  it('tracks a global goal across active accounts', async () => {
    const env = await setup();
    expect((await overview(env)).goal).toBeNull();
    await api(env, 'PATCH', '/api/settings', { savingsGoalCents: 1000000, savingsGoalDate: '2027-06-30' });
    await contribute(env, 'Livret A', '2026-10', 200000);
    await contribute(env, 'PEA', '2026-10', 300000, 310000);
    const goal = (await overview(env)).goal;
    expect(goal).toMatchObject({ targetCents: 1000000, date: '2027-06-30', currentCents: 510000 });
    expect(goal?.progress).toBeCloseTo(0.51);
  });
});
