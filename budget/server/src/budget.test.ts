import { describe, expect, it } from 'vitest';
import type {
  ApiError,
  BalanceDto,
  CategoryDto,
  DashboardCategory,
  DashboardDto,
  ExpenseDto,
  MonthDto,
  SettlementDto,
  TransferDto,
} from '@budget/shared';
import { api, catalog, categoryByName, createTestEnv, expenseBody, seedExample, type TestEnv } from './test-helpers.js';

async function setup(now?: string): Promise<TestEnv> {
  const env = createTestEnv(now ? { now } : {});
  await seedExample(env);
  return env;
}

async function dash(env: TestEnv, month = '2026-10'): Promise<DashboardDto> {
  return (await api<DashboardDto>(env, 'GET', `/api/months/${month}/dashboard`)).body;
}

async function cat(env: TestEnv, name: string, month = '2026-10'): Promise<DashboardCategory> {
  const found = (await dash(env, month)).groups.flatMap((g) => g.categories).find((c) => c.name === name);
  if (!found) throw new Error(`no ${name} in ${month}`);
  return found;
}

async function spend(env: TestEnv, categoryName: string, amountCents: number, date = '2026-10-15', extra: object = {}): Promise<ExpenseDto> {
  const c = await categoryByName(env, categoryName);
  const res = await api<ExpenseDto>(env, 'POST', '/api/expenses', expenseBody({ categoryId: c.id, payerId: 'p1', amountCents, date, ...extra }));
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body;
}

/** Moves the clock to the given day and lets the app create the month, as it would when opened. */
async function advanceTo(env: TestEnv, iso: string): Promise<void> {
  env.setNow(`${iso}T10:00:00Z`);
  await api(env, 'GET', '/api/session');
}

describe('monthly budget', () => {
  it('tracks planned, spent and remaining per category, rolled up to groups', async () => {
    const env = await setup();
    await spend(env, 'Courses', 12000);
    await spend(env, 'Restaurant', 3000);
    const d = await dash(env);
    const courses = await cat(env, 'Courses');
    expect(courses).toMatchObject({ planned: 40000, spent: 12000, remaining: 28000, status: 'ok' });
    const group = d.groups.find((g) => g.name === 'Alimentation');
    expect(group).toMatchObject({ planned: 50000, spent: 15000, remaining: 35000 });
  });

  it('warns above 80% and flags over-budget categories', async () => {
    const env = await setup();
    await spend(env, 'Courses', 33000); // 82.5% of 400
    expect((await cat(env, 'Courses')).status).toBe('warn');
    await spend(env, 'Courses', 7000); // exactly 100%
    expect((await cat(env, 'Courses')).status).toBe('over');
    await spend(env, 'Courses', 1000);
    expect((await cat(env, 'Courses')).remaining).toBe(-1000);
  });

  it('projects the end of the month from the current pace for variable categories', async () => {
    const env = await setup(); // 15 October, 31 days
    await spend(env, 'Courses', 15000);
    expect((await cat(env, 'Courses')).projected).toBe(Math.round((15000 * 31) / 15));
  });

  it('counts "Imprévus" expenses so they can be reassigned later', async () => {
    const env = await setup();
    const imprevus = (await catalog(env)).flatMap((g) => g.categories).find((c) => c.isSystem);
    await api(env, 'POST', '/api/expenses', expenseBody({ categoryId: imprevus?.id ?? '', payerId: 'p1', amountCents: 2500 }));
    const d = await dash(env);
    expect(d.imprevusCount).toBe(1);
    expect(d.imprevusCents).toBe(2500);
  });

  it('copies the previous month when a new month starts, leaving the past untouched', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    await api(env, 'PUT', '/api/months/2026-10/lines', { categoryId: food.id, subcategoryId: null, plannedCents: 45000 });
    await advanceTo(env, '2026-11-02');
    expect((await cat(env, 'Courses', '2026-11')).planned).toBe(45000);

    await api(env, 'PUT', '/api/months/2026-11/lines', { categoryId: food.id, subcategoryId: null, plannedCents: 38000 });
    expect((await cat(env, 'Courses', '2026-10')).planned).toBe(45000);
    expect((await cat(env, 'Courses', '2026-11')).planned).toBe(38000);
  });

  it('only changes the template for future months when asked to', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    await api(env, 'PUT', '/api/months/2026-10/lines', { categoryId: food.id, subcategoryId: null, plannedCents: 45000 });
    await api(env, 'POST', '/api/months/2026-09');
    expect((await cat(env, 'Courses', '2026-09')).planned).toBe(40000); // created from the template

    await api(env, 'PUT', '/api/months/2026-10/lines', { categoryId: food.id, subcategoryId: null, plannedCents: 41000, applyToTemplate: true });
    expect((await categoryByName(env, 'Courses')).plannedCents).toBe(41000);
    expect((await cat(env, 'Courses', '2026-09')).planned).toBe(40000);
  });

  it('applies a template change to the current month onwards, never to past months', async () => {
    const env = await setup();
    await api(env, 'POST', '/api/months/2026-09');
    const food = await categoryByName(env, 'Courses');
    await api(env, 'PATCH', `/api/categories/${food.id}`, { plannedCents: 50000 });
    expect((await cat(env, 'Courses', '2026-10')).planned).toBe(50000);
    expect((await cat(env, 'Courses', '2026-09')).planned).toBe(40000);
  });

  it('does not generate fixed expenses for a month created by a back-dated expense', async () => {
    const env = await setup();
    await spend(env, 'Courses', 2000, '2026-08-10');
    await api(env, 'GET', '/api/session'); // runs the daily tasks
    expect((await api<ExpenseDto[]>(env, 'GET', '/api/expenses?month=2026-08&status=pending')).body).toHaveLength(0);
  });

  it('generates fixed expenses when a past month is created explicitly', async () => {
    const env = await setup();
    await api(env, 'POST', '/api/months/2026-07');
    expect((await api<ExpenseDto[]>(env, 'GET', '/api/expenses?month=2026-07&status=pending')).body).toHaveLength(5);
  });

  it('refuses to read a month that was never created', async () => {
    const env = await setup();
    const res = await api<ApiError>(env, 'GET', '/api/months/2027-01/dashboard');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('month_not_found');
  });

  it('creates a month on demand and is idempotent', async () => {
    const env = await setup();
    expect((await api(env, 'POST', '/api/months/2026-12')).status).toBe(201);
    expect((await api(env, 'POST', '/api/months/2026-12')).status).toBe(200);
    expect((await api(env, 'POST', '/api/months/12-2026')).status).toBe(400);
  });
});

describe('rollover and provisions', () => {
  it('carries unspent money of a rollover category to the next month', async () => {
    const env = await setup();
    await spend(env, 'Entretien', 2000); // planned 50, spent 20 => 30 left
    await advanceTo(env, '2026-11-02');
    const nov = await cat(env, 'Entretien', '2026-11');
    expect(nov.carryIn).toBe(3000);
    expect(nov.effective).toBe(8000);
  });

  it('does not carry an overspend with rollover', async () => {
    const env = await setup();
    await spend(env, 'Entretien', 9000);
    await advanceTo(env, '2026-11-02');
    expect((await cat(env, 'Entretien', '2026-11')).carryIn).toBe(0);
  });

  it('does not carry anything for categories without rollover', async () => {
    const env = await setup();
    await spend(env, 'Loisirs', 1000);
    await advanceTo(env, '2026-11-02');
    const nov = await cat(env, 'Loisirs', '2026-11');
    expect(nov.carryIn).toBe(0);
    expect(nov.effective).toBe(20000);
  });

  it('accumulates provisions month after month until spent', async () => {
    const env = await setup();
    await advanceTo(env, '2026-11-02');
    await advanceTo(env, '2026-12-02');
    const dec = await cat(env, 'Noël', '2026-12');
    expect(dec.carryIn).toBe(10000); // two months of 50 already set aside
    expect(dec.effective).toBe(15000);

    await spend(env, 'Noël', 12000, '2026-12-10');
    await advanceTo(env, '2027-01-02');
    expect((await cat(env, 'Noël', '2027-01')).carryIn).toBe(3000);
  });
});

describe('envelope transfers', () => {
  it('moves budget between categories for one month and keeps the history', async () => {
    const env = await setup();
    const from = await categoryByName(env, 'Loisirs');
    const to = await categoryByName(env, 'Courses');
    const res = await api<TransferDto>(env, 'POST', '/api/months/2026-10/transfers', {
      fromCategoryId: from.id,
      toCategoryId: to.id,
      amountCents: 5000,
      note: 'courses plus chères',
    });
    expect(res.status).toBe(201);

    expect(await cat(env, 'Courses')).toMatchObject({ planned: 40000, transfersIn: 5000, effective: 45000 });
    expect(await cat(env, 'Loisirs')).toMatchObject({ planned: 20000, transfersOut: 5000, effective: 15000 });

    const list = (await api<TransferDto[]>(env, 'GET', '/api/months/2026-10/transfers')).body;
    expect(list).toHaveLength(1);
    expect(list[0]?.note).toBe('courses plus chères');
  });

  it('leaves other months untouched', async () => {
    const env = await setup();
    await api(env, 'POST', '/api/months/2026-09');
    const from = await categoryByName(env, 'Loisirs');
    const to = await categoryByName(env, 'Courses');
    await api(env, 'POST', '/api/months/2026-10/transfers', { fromCategoryId: from.id, toCategoryId: to.id, amountCents: 5000 });
    expect((await cat(env, 'Courses', '2026-09')).effective).toBe(40000);
  });

  it('feeds the carry of rollover categories', async () => {
    const env = await setup();
    const from = await categoryByName(env, 'Loisirs');
    const to = await categoryByName(env, 'Entretien');
    await api(env, 'POST', '/api/months/2026-10/transfers', { fromCategoryId: from.id, toCategoryId: to.id, amountCents: 3000 });
    await advanceTo(env, '2026-11-02');
    expect((await cat(env, 'Entretien', '2026-11')).carryIn).toBe(8000); // 50 + 30 moved in, nothing spent
  });

  it('can be undone', async () => {
    const env = await setup();
    const from = await categoryByName(env, 'Loisirs');
    const to = await categoryByName(env, 'Courses');
    const t = (await api<TransferDto>(env, 'POST', '/api/months/2026-10/transfers', { fromCategoryId: from.id, toCategoryId: to.id, amountCents: 5000 })).body;
    expect((await api(env, 'DELETE', `/api/months/2026-10/transfers/${t.id}`)).status).toBe(204);
    expect((await cat(env, 'Courses')).effective).toBe(40000);
    expect((await api(env, 'DELETE', `/api/months/2026-10/transfers/${t.id}`)).status).toBe(404);
  });

  it.each([
    ['the same category on both sides', (a: string) => ({ fromCategoryId: a, toCategoryId: a, amountCents: 100 }), 400],
    ['a zero amount', (a: string, b: string) => ({ fromCategoryId: a, toCategoryId: b, amountCents: 0 }), 400],
    ['an unknown category', (a: string) => ({ fromCategoryId: a, toCategoryId: 'nope', amountCents: 100 }), 404],
  ])('rejects %s', async (_label, body, status) => {
    const env = await setup();
    const a = await categoryByName(env, 'Loisirs');
    const b = await categoryByName(env, 'Courses');
    expect((await api(env, 'POST', '/api/months/2026-10/transfers', body(a.id, b.id))).status).toBe(status);
  });

  it('refuses transfers on a month that does not exist', async () => {
    const env = await setup();
    const a = await categoryByName(env, 'Loisirs');
    const b = await categoryByName(env, 'Courses');
    const res = await api(env, 'POST', '/api/months/2030-01/transfers', { fromCategoryId: a.id, toCategoryId: b.id, amountCents: 100 });
    expect(res.status).toBe(404);
  });
});

describe('category management', () => {
  it('adds a new category to the current month', async () => {
    const env = await setup();
    const group = (await catalog(env))[0];
    const res = await api<{ id: string }>(env, 'POST', '/api/categories', {
      groupId: group?.id,
      name: 'Jardin',
      kind: 'variable',
      plannedCents: 7000,
    });
    expect(res.status).toBe(201);
    expect(await cat(env, 'Jardin')).toMatchObject({ planned: 7000 });
  });

  it('turns a category into sub-lines, replacing its own line', async () => {
    const env = await setup();
    const sport = await categoryByName(env, 'Loisirs');
    await api(env, 'POST', '/api/subcategories', { categoryId: sport.id, name: 'Cinéma', plannedCents: 6000 });
    await api(env, 'POST', '/api/subcategories', { categoryId: sport.id, name: 'Sorties', plannedCents: 9000 });
    const d = await cat(env, 'Loisirs');
    expect(d.planned).toBe(15000);
    expect(d.subLines.map((s) => s.name)).toEqual(['Cinéma', 'Sorties']);
    expect((await categoryByName(env, 'Loisirs')).plannedCents).toBe(15000);
  });

  it('archives a category: history is kept, it is hidden from new expenses and future months', async () => {
    const env = await setup();
    const fun = await categoryByName(env, 'Loisirs');
    await spend(env, 'Loisirs', 2000);
    expect((await api(env, 'PATCH', `/api/categories/${fun.id}`, { archived: true })).status).toBe(200);

    const rejected = await api<ApiError>(env, 'POST', '/api/expenses', expenseBody({ categoryId: fun.id, payerId: 'p1' }));
    expect(rejected.body.error).toBe('category_archived');

    const history = (await api<ExpenseDto[]>(env, 'GET', `/api/expenses?categoryId=${fun.id}`)).body;
    expect(history).toHaveLength(1);

    await advanceTo(env, '2026-11-02');
    const nov = (await dash(env, '2026-11')).groups.flatMap((g) => g.categories).map((c) => c.name);
    expect(nov).not.toContain('Loisirs');
  });

  it('can edit an existing expense of an archived category without moving it', async () => {
    const env = await setup();
    const fun = await categoryByName(env, 'Loisirs');
    const e = await spend(env, 'Loisirs', 2000);
    await api(env, 'PATCH', `/api/categories/${fun.id}`, { archived: true });
    const res = await api(env, 'PUT', `/api/expenses/${e.id}`, expenseBody({ categoryId: fun.id, payerId: 'p1', amountCents: 2500 }));
    expect(res.status).toBe(200);
  });

  it('protects the built-in Imprévus category', async () => {
    const env = await setup();
    const imprevus = (await catalog(env)).flatMap((g) => g.categories).find((c) => c.isSystem) as CategoryDto;
    expect((await api(env, 'PATCH', `/api/categories/${imprevus.id}`, { archived: true })).status).toBe(400);
    const other = await categoryByName(env, 'Courses');
    expect((await api(env, 'POST', `/api/categories/${imprevus.id}/merge`, { intoCategoryId: other.id })).status).toBe(400);
  });

  it('merges a category into another, moving expenses and budget', async () => {
    const env = await setup();
    const from = await categoryByName(env, 'Restaurant');
    const into = await categoryByName(env, 'Courses');
    await spend(env, 'Restaurant', 4000);
    await spend(env, 'Courses', 1000);

    expect((await api(env, 'POST', `/api/categories/${from.id}/merge`, { intoCategoryId: into.id })).status).toBe(200);

    expect(await cat(env, 'Courses')).toMatchObject({ planned: 50000, spent: 5000 });
    const d = (await dash(env)).groups.flatMap((g) => g.categories).map((c) => c.name);
    expect(d).not.toContain('Restaurant');
    expect((await categoryByName(env, 'Restaurant')).archived).toBe(true);
  });

  it('reorders categories', async () => {
    const env = await setup();
    const group = (await catalog(env)).find((g) => g.name === 'Alimentation');
    const ids = group?.categories.map((c) => c.id) ?? [];
    await api(env, 'POST', '/api/catalog/reorder', { kind: 'category', ids: [...ids].reverse() });
    const after = (await catalog(env)).find((g) => g.name === 'Alimentation');
    expect(after?.categories.map((c) => c.id)).toEqual([...ids].reverse());
  });
});

describe('income ratio frozen per month', () => {
  it('does not rewrite a month when incomes change, until it is recalculated', async () => {
    const env = await setup();
    const e = await spend(env, 'Courses', 10000, '2026-10-15', { splitMode: 'income' });
    expect(e.shares).toEqual({ p1: 7500, p2: 2500 });
    const equal = await spend(env, 'Courses', 10000, '2026-10-16', { splitMode: 'equal' });

    const changed = await api<MonthDto>(env, 'PUT', '/api/months/2026-10/incomes', {
      incomes: [
        { personId: 'p1', amountCents: 200000 },
        { personId: 'p2', amountCents: 200000, note: 'prime exceptionnelle' },
      ],
    });
    expect(changed.body.ratio.p1).toBeCloseTo(0.75); // still frozen
    expect(changed.body.ratioStale).toBe(true);
    expect((await api<ExpenseDto>(env, 'GET', `/api/expenses/${e.id}`)).body.shares).toEqual({ p1: 7500, p2: 2500 });

    const recalc = await api<{ month: MonthDto; updatedExpenses: number }>(env, 'POST', '/api/months/2026-10/recalculate');
    expect(recalc.body.month.ratio.p1).toBeCloseTo(0.5);
    expect(recalc.body.month.ratioStale).toBe(false);
    expect((await api<ExpenseDto>(env, 'GET', `/api/expenses/${e.id}`)).body.shares).toEqual({ p1: 5000, p2: 5000 });
    expect((await api<ExpenseDto>(env, 'GET', `/api/expenses/${equal.id}`)).body.shares).toEqual({ p1: 5000, p2: 5000 });
    // 5 fixed expenses were also split on income: they are recomputed too
    expect(recalc.body.updatedExpenses).toBeGreaterThanOrEqual(2);
  });

  it('keeps past months intact when a later month starts with other incomes', async () => {
    const env = await setup();
    const e = await spend(env, 'Courses', 10000);
    await api(env, 'PUT', '/api/months/2026-10/incomes', {
      incomes: [
        { personId: 'p1', amountCents: 100000 },
        { personId: 'p2', amountCents: 300000 },
      ],
    });
    await advanceTo(env, '2026-11-02');

    const nov = (await api<MonthDto>(env, 'GET', '/api/months/2026-11')).body;
    expect(nov.ratio.p1).toBeCloseTo(0.25); // copied incomes, frozen at creation
    const oct = (await api<MonthDto>(env, 'GET', '/api/months/2026-10')).body;
    expect(oct.ratio.p1).toBeCloseTo(0.75);
    expect((await api<ExpenseDto>(env, 'GET', `/api/expenses/${e.id}`)).body.shares).toEqual({ p1: 7500, p2: 2500 });
  });

  it('uses the new month ratio for the fixed expenses generated for it', async () => {
    const env = await setup();
    await api(env, 'PUT', '/api/months/2026-10/incomes', {
      incomes: [
        { personId: 'p1', amountCents: 100000 },
        { personId: 'p2', amountCents: 300000 },
      ],
    });
    await advanceTo(env, '2026-11-02');
    const [rent] = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?month=2026-11&q=Loyer')).body;
    expect(rent?.shares).toEqual({ p1: 25000, p2: 75000 });
  });

  it('falls back to the previous month ratio when no income is entered', async () => {
    const env = await setup();
    await api(env, 'PUT', '/api/months/2026-10/incomes', {
      incomes: [
        { personId: 'p1', amountCents: 0 },
        { personId: 'p2', amountCents: 0 },
      ],
    });
    await advanceTo(env, '2026-11-02');
    const nov = (await api<MonthDto>(env, 'GET', '/api/months/2026-11')).body;
    expect(nov.ratio.p1).toBeCloseTo(0.75);
    expect(nov.ratioStale).toBe(false);
  });

  it('splits 50/50 when no income was ever entered', async () => {
    const env = createTestEnv();
    const seed = { version: 1, people: [{ name: 'A', monthlyIncome: 0 }, { name: 'B', monthlyIncome: 0 }], groups: [{ name: 'G', categories: [{ name: 'C', amount: 10, type: 'variable' }] }] };
    expect((await api(env, 'POST', '/api/setup/seed', seed)).status).toBe(201);
    const c = await categoryByName(env, 'C');
    const e = await api<ExpenseDto>(env, 'POST', '/api/expenses', expenseBody({ categoryId: c.id, payerId: 'p1', amountCents: 1001 }));
    expect(e.body.shares).toEqual({ p1: 501, p2: 500 });
  });
});

describe('balance and settlements', () => {
  it('shows who owes whom for the month and overall', async () => {
    const env = await setup();
    await spend(env, 'Courses', 10000, '2026-10-15', { splitMode: 'equal' });
    const b = (await api<BalanceDto>(env, 'GET', '/api/balance?month=2026-10')).body;
    // the pending fixed expenses (paid by p1, split on income) add to what p2 owes: 5000 + 27000
    expect(b.monthBalance.debt).toEqual({ debtorId: 'p2', creditorId: 'p1', amountCents: 32000 });
    expect(b.overallBalance.debt?.amountCents).toBe(32000);
    expect(b.ratio.p1).toBeCloseTo(0.75);
  });

  it('ignores personal expenses paid by the person who bears them', async () => {
    const env = await setup();
    await spend(env, 'Courses', 5000, '2026-10-15', { splitMode: 'single', singleId: 'p1' });
    const without = (await api<BalanceDto>(env, 'GET', '/api/balance?month=2026-10')).body;
    expect(without.monthBalance.debt?.amountCents).toBe(27000);
  });

  it('charges the other person when one pays for the other', async () => {
    const env = await setup();
    await spend(env, 'Courses', 5000, '2026-10-15', { splitMode: 'single', singleId: 'p2' });
    const b = (await api<BalanceDto>(env, 'GET', '/api/balance?month=2026-10')).body;
    expect(b.monthBalance.debt?.amountCents).toBe(32000);
  });

  it('records a reimbursement and keeps a history', async () => {
    const env = await setup();
    const before = (await api<BalanceDto>(env, 'GET', '/api/balance?month=2026-10')).body;
    const owed = before.overallBalance.debt?.amountCents ?? 0;

    const res = await api<SettlementDto>(env, 'POST', '/api/settlements', { date: '2026-10-20', fromId: 'p2', toId: 'p1', amountCents: 10000, note: 'virement' });
    expect(res.status).toBe(201);
    const partial = (await api<BalanceDto>(env, 'GET', '/api/balance?month=2026-10')).body;
    expect(partial.overallBalance.debt?.amountCents).toBe(owed - 10000);
    expect(partial.settlements).toHaveLength(1);

    await api(env, 'POST', '/api/settlements', { date: '2026-10-21', fromId: 'p2', toId: 'p1', amountCents: owed - 10000 });
    const settled = (await api<BalanceDto>(env, 'GET', '/api/balance?month=2026-10')).body;
    expect(settled.overallBalance.debt).toBeNull();
    expect(settled.settlements.map((s) => s.date)).toEqual(['2026-10-21', '2026-10-20']);
  });

  it('flips the debt when someone over-reimburses', async () => {
    const env = await setup();
    const owed = ((await api<BalanceDto>(env, 'GET', '/api/balance?month=2026-10')).body.overallBalance.debt?.amountCents ?? 0);
    await api(env, 'POST', '/api/settlements', { date: '2026-10-20', fromId: 'p2', toId: 'p1', amountCents: owed + 500 });
    const b = (await api<BalanceDto>(env, 'GET', '/api/balance?month=2026-10')).body;
    expect(b.overallBalance.debt).toEqual({ debtorId: 'p1', creditorId: 'p2', amountCents: 500 });
  });

  it('cancels a reimbursement', async () => {
    const env = await setup();
    const s = (await api<SettlementDto>(env, 'POST', '/api/settlements', { date: '2026-10-20', fromId: 'p2', toId: 'p1', amountCents: 10000 })).body;
    expect((await api(env, 'DELETE', `/api/settlements/${s.id}`)).status).toBe(204);
    expect((await api<BalanceDto>(env, 'GET', '/api/balance?month=2026-10')).body.settlements).toHaveLength(0);
    expect((await api(env, 'DELETE', `/api/settlements/${s.id}`)).status).toBe(404);
  });

  it('separates the month balance from the overall one', async () => {
    const env = await setup();
    await spend(env, 'Courses', 10000, '2026-09-10', { splitMode: 'equal' });
    const b = (await api<BalanceDto>(env, 'GET', '/api/balance?month=2026-10')).body;
    expect(b.monthBalance.debt?.amountCents).toBe(27000);
    expect(b.overallBalance.debt?.amountCents).toBe(27000 + 5000);
  });

  it('reports what each person paid and bears in the month', async () => {
    const env = await setup();
    await spend(env, 'Courses', 10000, '2026-10-15', { splitMode: 'equal' });
    const b = (await api<BalanceDto>(env, 'GET', '/api/balance?month=2026-10')).body;
    // fixed expenses (1000 + 50 + 100 + 20 + 10 euros, all paid by p1) plus the new 100 euros
    expect(b.monthPaid.p1).toBe(128000);
    expect(b.monthPaid.p2).toBe(0);
  });

  it.each([
    ['the same person on both sides', { fromId: 'p1', toId: 'p1', amountCents: 100 }],
    ['a zero amount', { fromId: 'p2', toId: 'p1', amountCents: 0 }],
    ['an unknown person', { fromId: 'p2', toId: 'zzz', amountCents: 100 }],
  ])('rejects a settlement with %s', async (_label, body) => {
    const env = await setup();
    const res = await api(env, 'POST', '/api/settlements', { date: '2026-10-20', ...body });
    expect(res.status).toBe(400);
  });
});
