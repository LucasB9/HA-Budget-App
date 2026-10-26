import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiError, ExpenseDto } from '@budget/shared';
import { buildApp } from './app.js';
import { createHaPublisher, type HaClient } from './ha/publisher.js';
import { resetShortcutGuard } from './routes/shortcut.js';
import { api, categoryByName, createTestEnv, expenseBody, loadExampleSeed, seedExample, type TestEnv } from './test-helpers.js';

/** Intl puts a (narrow) no-break space before the euro sign: compare with plain spaces. */
const plain = (value: unknown): string => String(value).replace(/[\u00a0\u202f]/g, ' ');

interface Published {
  entityId: string;
  state: string | number;
  attributes: Record<string, unknown>;
}

function fakeHa(failWith?: Error): HaClient & { calls: Published[] } {
  const calls: Published[] = [];
  return {
    calls,
    async setState(entityId, state, attributes) {
      if (failWith) throw failWith;
      calls.push({ entityId, state, attributes });
    },
  };
}

const latest = (ha: { calls: Published[] }, entityId: string): Published | undefined => [...ha.calls].reverse().find((c) => c.entityId === entityId);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function setup(): Promise<TestEnv> {
  const env = createTestEnv();
  await seedExample(env);
  return env;
}

describe('Home Assistant sensors', () => {
  it('publishes the current month values', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    await api(env, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p1', amountCents: 10000, splitMode: 'equal' }));
    const pending = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?status=pending')).body;
    for (const e of pending) await api(env, 'POST', `/api/expenses/${e.id}/confirm`, {});

    const ha = fakeHa();
    await createHaPublisher(env.ctx, ha).publishNow();

    expect(ha.calls.map((c) => c.entityId).sort()).toEqual([
      'sensor.budget_balance_owed',
      'sensor.budget_over_budget_categories',
      'sensor.budget_pending_expenses',
      'sensor.budget_projected',
      'sensor.budget_remaining',
      'sensor.budget_savings_rate',
      'sensor.budget_spent',
      'sensor.budget_spent_percent',
    ]);
    // planned 2410 euros, spent: 5 fixed (1000 + 50 + 100 + 20 + 10) + 100 = 1280
    expect(latest(ha, 'sensor.budget_spent')?.state).toBe(1280);
    expect(latest(ha, 'sensor.budget_remaining')).toMatchObject({ state: 1130, attributes: { unit_of_measurement: '€', month: '2026-10' } });
    expect(latest(ha, 'sensor.budget_pending_expenses')?.state).toBe(0);
    const owed = latest(ha, 'sensor.budget_balance_owed');
    expect(owed).toMatchObject({ state: 320, attributes: { debtor: 'Sam', creditor: 'Alex' } });
    expect(plain(owed?.attributes.summary)).toBe('Sam doit 320,00 € à Alex');
    expect(latest(ha, 'sensor.budget_savings_rate')?.state).toBe(0);
    // 1280 spent of a 2410 budget
    expect(latest(ha, 'sensor.budget_spent_percent')?.state).toBe(53.1);
    expect(latest(ha, 'sensor.budget_over_budget_categories')).toMatchObject({ state: 0, attributes: { categories: [] } });
  });

  it('lists the categories that went over budget, but not Imprévus', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    const imprevus = (await api<{ categories: { id: string; isSystem: boolean }[] }[]>(env, 'GET', '/api/catalog')).body.flatMap((g) => g.categories).find((c) => c.isSystem);
    await api(env, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p1', amountCents: 45000 }));
    await api(env, 'POST', '/api/expenses', expenseBody({ categoryId: imprevus?.id ?? '', payerId: 'p1', amountCents: 2000 }));
    const ha = fakeHa();
    await createHaPublisher(env.ctx, ha).publishNow();
    expect(latest(ha, 'sensor.budget_over_budget_categories')).toMatchObject({
      state: 1,
      attributes: { categories: ['Courses'], imprevus_to_reclassify: 1 },
    });
  });

  it('reports a settled balance', async () => {
    const env = await setup();
    const ha = fakeHa();
    await createHaPublisher(env.ctx, ha).publishNow();
    expect(latest(ha, 'sensor.budget_balance_owed')).toMatchObject({ state: 0, attributes: { summary: 'À jour', debtor: null } });
    expect(latest(ha, 'sensor.budget_pending_expenses')?.state).toBe(5);
  });

  it('publishes nothing before the household is configured', async () => {
    const env = createTestEnv();
    const ha = fakeHa();
    await createHaPublisher(env.ctx, ha).publishNow();
    expect(ha.calls).toEqual([]);
  });

  it('never throws when Home Assistant is unreachable, and reports it', async () => {
    const env = await setup();
    const errors: unknown[] = [];
    const publisher = createHaPublisher(env.ctx, fakeHa(new Error('401')), { onError: (e) => errors.push(e) });
    await expect(publisher.publishNow()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it('merges a burst of changes into one publish', async () => {
    const env = await setup();
    const ha = fakeHa();
    const publisher = createHaPublisher(env.ctx, ha, { delayMs: 15 });
    publisher.schedule();
    publisher.schedule();
    publisher.schedule();
    expect(ha.calls).toHaveLength(0);
    await sleep(80);
    expect(ha.calls).toHaveLength(8);
  });

  it('republishes after a successful change, but not after a read or a failed change', async () => {
    const env = createTestEnv();
    const ha = fakeHa();
    const app = buildApp(env.ctx, { haPublisher: createHaPublisher(env.ctx, ha, { delayMs: 5 }) });
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });

    await post('/api/setup/seed', loadExampleSeed() as object);
    await sleep(60);
    const afterSeed = ha.calls.length;
    expect(afterSeed).toBeGreaterThan(0);

    await app.inject({ method: 'GET', url: '/api/session' });
    await post('/api/expenses', { nope: true }); // 400
    await sleep(60);
    expect(ha.calls.length).toBe(afterSeed);

    const food = (await app.inject({ method: 'GET', url: '/api/catalog' })).json<{ categories: { id: string; name: string }[] }[]>().flatMap((g) => g.categories).find((c) => c.name === 'Courses');
    await post('/api/expenses', expenseBody({ categoryId: food?.id ?? '', payerId: 'p1' }));
    await sleep(60);
    expect(ha.calls.length).toBeGreaterThan(afterSeed);
  });
});

describe('iOS Shortcut endpoint', () => {
  beforeEach(() => resetShortcutGuard());

  async function withToken(): Promise<TestEnv> {
    const env = createTestEnv({ config: { shortcutToken: 'tok-123' } });
    await seedExample(env);
    return env;
  }
  const send = (env: TestEnv, body: unknown, token: string | null = 'tok-123', url = '/api/shortcut/expense') =>
    env.app.inject({
      method: 'POST',
      url,
      payload: body as object,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('is disabled until a token is configured', async () => {
    const env = await setup();
    const res = await send(env, { amount: 5 }, 'whatever');
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiError>().error).toBe('shortcut_disabled');
  });

  it('rejects a missing or wrong token', async () => {
    const env = await withToken();
    expect((await send(env, { amount: 5 }, null)).statusCode).toBe(401);
    expect((await send(env, { amount: 5 }, 'nope')).statusCode).toBe(401);
  });

  it('locks out an address after too many wrong tokens', async () => {
    const env = await withToken();
    for (let i = 0; i < 10; i++) await send(env, { amount: 5 }, `bad-${i}`);
    const locked = await send(env, { amount: 5 }, 'tok-123');
    expect(locked.statusCode).toBe(429);
  });

  it('creates an expense from a name and a decimal-comma amount', async () => {
    const env = await withToken();
    const res = await send(env, { amount: '42,50', category: 'courses', payer: 'sam', note: 'via raccourci', tags: 'bio, vrac' });
    expect(res.statusCode).toBe(201);
    expect(plain(res.json<{ summary: string }>().summary)).toBe('42,50 € · Courses · payé par Sam');

    const [expense] = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?q=raccourci')).body;
    expect(expense).toMatchObject({ amountCents: 4250, payerId: 'p2', splitMode: 'income', tags: ['bio', 'vrac'], createdBy: 'raccourci', status: 'confirmed' });
  });

  it('defaults to today, the first person and the household split', async () => {
    const env = await withToken();
    await send(env, { amount: 12, category: 'Loisirs' });
    const [expense] = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?q=Loisirs')).body;
    expect(expense).toMatchObject({ date: '2026-10-15', payerId: 'p1', amountCents: 1200 });
  });

  it('matches a unique partial category name and supports a personal split', async () => {
    const env = await withToken();
    const res = await send(env, { amount: 5, category: 'electr', split: 'personal', payer: 'Sam' });
    expect(res.json<{ summary: string }>().summary).toContain('Électricité');
    const [expense] = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?q=Électricité&status=confirmed')).body;
    expect(expense).toMatchObject({ splitMode: 'single', singleId: 'p2', payerId: 'p2' });
  });

  it('files an unknown category under Imprévus and says so', async () => {
    const env = await withToken();
    const res = await send(env, { amount: 7, category: 'Licorne' });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ summary: string }>().summary).toContain('Imprévus');
    expect(res.json<{ summary: string }>().summary).toContain('Licorne');
  });

  it('rejects an invalid amount, date or payer', async () => {
    const env = await withToken();
    expect((await send(env, { amount: 'beaucoup' })).statusCode).toBe(400);
    expect((await send(env, { amount: 0 })).statusCode).toBe(400);
    expect((await send(env, { amount: 5, date: 'hier' })).statusCode).toBe(400);
    expect((await send(env, { amount: 5, payer: 'Zoé' })).statusCode).toBe(400);
  });

  it('lists the names to offer in a Shortcut menu', async () => {
    const env = await withToken();
    const res = await env.app.inject({ method: 'GET', url: '/api/shortcut/options', headers: { authorization: 'Bearer tok-123' } });
    const body = res.json<{ categories: string[]; people: string[] }>();
    expect(body.people).toEqual(['Alex', 'Sam']);
    expect(body.categories).toContain('Courses');
    expect(body.categories).not.toContain('Imprévus');
  });

  it('is reachable from outside the ingress gateway with the token, while the rest stays blocked', async () => {
    const env = createTestEnv({ config: { shortcutToken: 'tok-123', enforceIngress: true } });
    const seeded = await env.app.inject({ method: 'POST', url: '/api/setup/seed', remoteAddress: '172.30.32.2', payload: loadExampleSeed() as object });
    expect(seeded.statusCode).toBe(201);

    const outside = '100.64.0.9'; // e.g. a Tailscale address
    const ok = await env.app.inject({ method: 'POST', url: '/api/shortcut/expense', remoteAddress: outside, payload: { amount: 5, category: 'Courses' }, headers: { authorization: 'Bearer tok-123' } });
    expect(ok.statusCode).toBe(201);
    const noToken = await env.app.inject({ method: 'POST', url: '/api/shortcut/expense', remoteAddress: outside, payload: { amount: 5 } });
    expect(noToken.statusCode).toBe(401);
    for (const url of ['/api/session', '/api/expenses', '/api/backup', '/api/months/2026-10/dashboard']) {
      const blocked = await env.app.inject({ method: 'GET', url, remoteAddress: outside, headers: { authorization: 'Bearer tok-123' } });
      expect(blocked.statusCode, url).toBe(403);
    }
  });
});
