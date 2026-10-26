import { describe, expect, it } from 'vitest';
import type { ApiError, ExpenseDto, ExpenseInput, MonthDto, TagSummaryRow } from '@budget/shared';
import { api, categoryByName, createTestEnv, expenseBody, seedExample, type TestEnv } from './test-helpers.js';

// The example seed: Alex (p1) earns 3000, Sam (p2) earns 1000 => frozen ratio 75% / 25%.

async function setup(now?: string): Promise<TestEnv> {
  const env = createTestEnv(now ? { now } : {});
  await seedExample(env);
  return env;
}

const sum = (shares: Record<string, number>): number => Object.values(shares).reduce((a, b) => a + b, 0);

describe('creating expenses', () => {
  it('splits proportionally to income and gives the leftover cent to the payer', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    const res = await api<ExpenseDto>(
      env,
      'POST',
      '/api/expenses',
      expenseBody({ categoryId: food.id, payerId: 'p2', amountCents: 10001 }),
    );
    expect(res.status).toBe(201);
    // floor(10001 * 0.75) = 7500, floor(10001 * 0.25) = 2500, 1 cent left for the payer (p2)
    expect(res.body.shares).toEqual({ p1: 7500, p2: 2501 });
    expect(sum(res.body.shares)).toBe(10001);
  });

  it('supports 50/50, 100% for one person and custom percentages', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    const post = (overrides: object) =>
      api<ExpenseDto>(env, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p1', amountCents: 9001, ...overrides }));

    expect((await post({ splitMode: 'equal' })).body.shares).toEqual({ p1: 4501, p2: 4500 });
    expect((await post({ splitMode: 'single', singleId: 'p2' })).body.shares).toEqual({ p1: 0, p2: 9001 });
    const custom = await post({ splitMode: 'custom', customBp: { p1: 6000, p2: 4000 } });
    expect(custom.body.shares).toEqual({ p1: 5401, p2: 3600 });
    expect(custom.body.customBp).toEqual({ p1: 6000, p2: 4000 });
  });

  it('stores tags case-insensitively and trims them', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    await api(env, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p1', tags: ['Vacances', ' cadeau '] }));
    const second = await api<ExpenseDto>(
      env,
      'POST',
      '/api/expenses',
      expenseBody({ categoryId: food.id, payerId: 'p1', tags: ['vacances'] }),
    );
    expect(second.body.tags).toEqual(['Vacances']);
    const tags = (await api<{ name: string; count: number }[]>(env, 'GET', '/api/tags')).body;
    expect(tags).toEqual([
      { name: 'Vacances', count: 2 },
      { name: 'cadeau', count: 1 },
    ]);
  });

  it('creates the month of the expense when it does not exist yet', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    expect((await api(env, 'GET', '/api/months/2026-08')).status).toBe(404);
    const res = await api(env, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p1', date: '2026-08-10' }));
    expect(res.status).toBe(201);
    expect((await api<MonthDto>(env, 'GET', '/api/months/2026-08')).status).toBe(200);
  });

  const invalidCases: [string, Partial<ExpenseInput>, string][] = [
    ['a zero amount', { amountCents: 0 }, 'amountCents'],
    ['a negative amount', { amountCents: -5 }, 'amountCents'],
    ['a fractional amount', { amountCents: 10.5 }, 'amountCents'],
    ['a malformed date', { date: '2026-13-40' }, 'date'],
    ['custom percentages that do not sum to 100%', { splitMode: 'custom', customBp: { p1: 5000, p2: 4000 } }, 'customBp'],
    ['a single split without a person', { splitMode: 'single' }, 'singleId'],
  ];
  it.each(invalidCases)('rejects %s', async (_label, overrides, field) => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    const res = await api<ApiError>(env, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p1', ...overrides }));
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(field);
  });

  it('rejects an unknown category, payer, or a sub-line of another category', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    const pets = await categoryByName(env, 'Animaux');
    const vet = pets.subcategories[0];

    expect((await api<ApiError>(env, 'POST', '/api/expenses', expenseBody({ categoryId: 'nope', payerId: 'p1' }))).body.error).toBe(
      'category_not_found',
    );
    expect((await api<ApiError>(env, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'zzz' }))).body.error).toBe(
      'unknown_person',
    );
    const mismatch = await api<ApiError>(
      env,
      'POST',
      '/api/expenses',
      expenseBody({ categoryId: food.id, payerId: 'p1', subcategoryId: vet?.id ?? null }),
    );
    expect(mismatch.body.error).toBe('subcategory_mismatch');
  });

  it('accepts an expense on a sub-line', async () => {
    const env = await setup();
    const pets = await categoryByName(env, 'Animaux');
    const res = await api<ExpenseDto>(
      env,
      'POST',
      '/api/expenses',
      expenseBody({ categoryId: pets.id, payerId: 'p1', subcategoryId: pets.subcategories[1]?.id ?? null }),
    );
    expect(res.status).toBe(201);
    expect(res.body.subcategoryId).toBe(pets.subcategories[1]?.id);
  });
});

describe('editing and listing expenses', () => {
  it('reassigns an expense to another category and recomputes the totals', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    const fun = await categoryByName(env, 'Loisirs');
    const created = (await api<ExpenseDto>(env, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p1', amountCents: 5000 }))).body;

    const dashBefore = (await api<{ groups: { categories: { name: string; spent: number }[] }[] }>(env, 'GET', '/api/months/2026-10/dashboard')).body;
    const spentOf = (d: typeof dashBefore, name: string): number | undefined =>
      d.groups.flatMap((g) => g.categories).find((c) => c.name === name)?.spent;
    expect(spentOf(dashBefore, 'Courses')).toBe(5000);

    const moved = await api<ExpenseDto>(env, 'PUT', `/api/expenses/${created.id}`, expenseBody({ categoryId: fun.id, payerId: 'p1', amountCents: 5000 }));
    expect(moved.status).toBe(200);
    const dashAfter = (await api<typeof dashBefore>(env, 'GET', '/api/months/2026-10/dashboard')).body;
    expect(spentOf(dashAfter, 'Courses')).toBe(0);
    expect(spentOf(dashAfter, 'Loisirs')).toBe(5000);
  });

  it('recomputes the shares when the amount or split changes', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    const created = (await api<ExpenseDto>(env, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p1', amountCents: 10000 }))).body;
    const updated = (
      await api<ExpenseDto>(env, 'PUT', `/api/expenses/${created.id}`, expenseBody({ categoryId: food.id, payerId: 'p1', amountCents: 4000, splitMode: 'equal' }))
    ).body;
    expect(updated.shares).toEqual({ p1: 2000, p2: 2000 });
  });

  it('confirms a pending fixed expense with its real amount and recomputes its split', async () => {
    const env = await setup();
    const [pending] = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?status=pending&q=Loyer')).body;
    expect(pending?.amountCents).toBe(100000);
    const res = await api<ExpenseDto>(env, 'POST', `/api/expenses/${pending?.id}/confirm`, { amountCents: 100400 });
    expect(res.body.status).toBe('confirmed');
    expect(res.body.amountCents).toBe(100400);
    expect(sum(res.body.shares)).toBe(100400);
    expect(res.body.shares.p2).toBe(25100);
  });

  it('confirming without an amount keeps the planned one', async () => {
    const env = await setup();
    const [pending] = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?status=pending')).body;
    const res = await api<ExpenseDto>(env, 'POST', `/api/expenses/${pending?.id}/confirm`, {});
    expect(res.body.status).toBe('confirmed');
    expect(res.body.amountCents).toBe(pending?.amountCents);
  });

  it('editing a pending expense confirms it', async () => {
    const env = await setup();
    const [pending] = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?status=pending')).body;
    const res = await api<ExpenseDto>(
      env,
      'PUT',
      `/api/expenses/${pending?.id}`,
      expenseBody({ categoryId: pending?.categoryId ?? '', payerId: pending?.payerId ?? 'p1', amountCents: 1234, date: pending?.date ?? '2026-10-01' }),
    );
    expect(res.body.status).toBe('confirmed');
  });

  it('returns 404 when editing or deleting an unknown expense', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    expect((await api(env, 'PUT', '/api/expenses/nope', expenseBody({ categoryId: food.id, payerId: 'p1' }))).status).toBe(404);
    expect((await api(env, 'DELETE', '/api/expenses/nope')).status).toBe(404);
  });

  it('filters by month, category, tag, payer and free text', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    const fun = await categoryByName(env, 'Loisirs');
    await api(env, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p1', note: 'marché du samedi', tags: ['bio'] }));
    await api(env, 'POST', '/api/expenses', expenseBody({ categoryId: fun.id, payerId: 'p2', note: 'cinéma', date: '2026-09-20' }));

    const ids = async (query: string): Promise<string[]> =>
      (await api<ExpenseDto[]>(env, 'GET', `/api/expenses?${query}`)).body.map((e) => e.note);

    expect(await ids(`categoryId=${food.id}`)).toEqual(['marché du samedi']);
    expect(await ids('tag=BIO')).toEqual(['marché du samedi']);
    expect(await ids('q=marché')).toEqual(['marché du samedi']);
    expect(await ids('q=loisirs')).toEqual(['cinéma']);
    expect(await ids('month=2026-09')).toEqual(['cinéma']);
    expect(await ids('personId=p2')).toEqual(['cinéma']);
  });

  it('treats search wildcards literally', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    await api(env, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p1', note: '100% bio' }));
    await api(env, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p1', note: 'autre' }));
    const found = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?q=%25')).body;
    expect(found.map((e) => e.note)).toEqual(['100% bio']);
  });

  it('summarizes totals per tag across categories and months', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    const fun = await categoryByName(env, 'Loisirs');
    await api(env, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p1', amountCents: 3000, tags: ['vacances'] }));
    await api(env, 'POST', '/api/expenses', expenseBody({ categoryId: fun.id, payerId: 'p1', amountCents: 5000, tags: ['vacances'], date: '2026-09-02' }));
    const [row] = (await api<TagSummaryRow[]>(env, 'GET', '/api/tags/summary')).body;
    expect(row).toMatchObject({ tag: 'vacances', totalCents: 8000, count: 2 });
    expect(row?.byMonth).toEqual({ '2026-10': 3000, '2026-09': 5000 });
    expect(row?.byCategory).toEqual({ [food.id]: 3000, [fun.id]: 5000 });
  });
});
