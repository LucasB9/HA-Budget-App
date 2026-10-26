import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ApiError, DashboardDto, ExpenseDto, MonthDto, SessionDto } from '@budget/shared';
import { api, createTestEnv, loadExampleSeed, seedExample } from './test-helpers.js';

describe('first run and seed import', () => {
  it('reports that setup is needed on an empty database', async () => {
    const env = createTestEnv();
    const { body } = await api<SessionDto>(env, 'GET', '/api/session');
    expect(body.needsSetup).toBe(true);
    expect(body.people).toEqual([]);
    expect(body.currentMonth).toBe('2026-10');
  });

  it('imports the example seed and creates the current month', async () => {
    const env = createTestEnv();
    await seedExample(env);

    const session = (await api<SessionDto>(env, 'GET', '/api/session')).body;
    expect(session.needsSetup).toBe(false);
    expect(session.people.map((p) => p.name)).toEqual(['Alex', 'Sam']);

    const month = (await api<MonthDto>(env, 'GET', '/api/months/2026-10')).body;
    expect(month.incomes.map((i) => i.amountCents)).toEqual([300000, 100000]);
    expect(month.ratio.p1).toBeCloseTo(0.75, 5);
  });

  it('computes the planned totals and balance from the template', async () => {
    const env = createTestEnv();
    await seedExample(env);
    const dash = (await api<DashboardDto>(env, 'GET', '/api/months/2026-10/dashboard')).body;
    // 1000+50+100 + 400+100 + 100+50 + 100 + 100 + 20+10 + 200+100 + 50+30
    expect(dash.totals.planned).toBe(241000);
    expect(dash.totals.income).toBe(400000);
    expect(dash.totals.plannedBalance).toBe(159000);
  });

  it('adds the built-in Imprévus category', async () => {
    const env = createTestEnv();
    await seedExample(env);
    const groups = (await api<{ categories: { name: string; isSystem: boolean }[] }[]>(env, 'GET', '/api/catalog')).body;
    const imprevus = groups.flatMap((g) => g.categories).find((c) => c.isSystem);
    expect(imprevus?.name).toBe('Imprévus');
  });

  it('keeps category totals equal to the sum of their sub-lines', async () => {
    const env = createTestEnv();
    await seedExample(env);
    const dash = (await api<DashboardDto>(env, 'GET', '/api/months/2026-10/dashboard')).body;
    const animaux = dash.groups.flatMap((g) => g.categories).find((c) => c.name === 'Animaux');
    expect(animaux?.planned).toBe(10000);
    expect(animaux?.subLines.map((s) => [s.name, s.planned])).toEqual([
      ['Croquettes', 4000],
      ['Vétérinaire', 6000],
    ]);
  });

  it('generates fixed expenses that are due, as pending, once', async () => {
    const env = createTestEnv();
    await seedExample(env);
    const first = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?month=2026-10&status=pending')).body;
    expect(first.map((e) => e.auto)).toEqual(first.map(() => true));
    expect(first).toHaveLength(5); // Loyer, Électricité, Mutuelle Alex, Streaming, Cloud

    await api(env, 'GET', '/api/session'); // runs the daily tasks again
    const again = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?month=2026-10&status=pending')).body;
    expect(again).toHaveLength(5);
  });

  it('does not recreate a deleted fixed expense', async () => {
    const env = createTestEnv();
    await seedExample(env);
    const [one] = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?status=pending')).body;
    expect((await api(env, 'DELETE', `/api/expenses/${one?.id}`)).status).toBe(204);
    await api(env, 'GET', '/api/session');
    const left = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?status=pending')).body;
    expect(left).toHaveLength(4);
  });

  it('waits for the configured day before generating a fixed expense', async () => {
    const env = createTestEnv({ now: '2026-10-02T10:00:00Z' });
    const seed = loadExampleSeed() as { groups: { categories: { name: string; day?: number }[] }[] };
    seed.groups[0]!.categories.find((c) => c.name === 'Loyer')!.day = 5;
    expect((await api(env, 'POST', '/api/setup/seed', seed)).status).toBe(201);
    const pending = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?status=pending')).body;
    expect(pending).toHaveLength(4);

    env.setNow('2026-10-05T08:00:00Z');
    await api(env, 'GET', '/api/session');
    expect((await api<ExpenseDto[]>(env, 'GET', '/api/expenses?status=pending')).body).toHaveLength(5);
  });

  it('refuses a second import', async () => {
    const env = createTestEnv();
    await seedExample(env);
    const second = await api<ApiError>(env, 'POST', '/api/setup/seed', loadExampleSeed());
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('already_seeded');
  });

  it('rejects an invalid seed with a readable message', async () => {
    const env = createTestEnv();
    const res = await api<ApiError>(env, 'POST', '/api/setup/seed', { version: 1, people: [{ name: 'Solo' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.message).toContain('people');
  });

  it('rejects sub-lines that do not add up to the category amount', async () => {
    const env = createTestEnv();
    const seed = loadExampleSeed() as { groups: { categories: { name: string; amount: number }[] }[] };
    seed.groups[4]!.categories[0]!.amount = 150;
    const res = await api<ApiError>(env, 'POST', '/api/setup/seed', seed);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Animaux');
  });

  it('serves the example seed for the wizard', async () => {
    const env = createTestEnv();
    const res = await api<{ version: number }>(env, 'GET', '/api/setup/example');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
  });
});

describe('Home Assistant ingress', () => {
  it('rejects requests that do not come from the ingress gateway', async () => {
    const env = createTestEnv({ config: { enforceIngress: true } });
    const denied = await env.app.inject({ method: 'GET', url: '/api/health', remoteAddress: '192.168.1.50' });
    expect(denied.statusCode).toBe(403);
    const allowed = await env.app.inject({ method: 'GET', url: '/api/health', remoteAddress: '172.30.32.2' });
    expect(allowed.statusCode).toBe(200);
  });

  it('accepts the IPv4-mapped form of the gateway address', async () => {
    const env = createTestEnv({ config: { enforceIngress: true } });
    const res = await env.app.inject({ method: 'GET', url: '/api/health', remoteAddress: '::ffff:172.30.32.2' });
    expect(res.statusCode).toBe(200);
  });

  it('matches the logged-in HA user to a person', async () => {
    const env = createTestEnv();
    await seedExample(env);
    const res = await env.app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { 'x-remote-user-display-name': 'sam', 'x-remote-user-id': 'abc' },
    });
    const body = res.json<SessionDto>();
    expect(body.me).toBe('p2');
    expect(body.haUser?.displayName).toBe('sam');
  });

  it('leaves `me` empty without ingress headers', async () => {
    const env = createTestEnv();
    await seedExample(env);
    const body = (await api<SessionDto>(env, 'GET', '/api/session')).body;
    expect(body.me).toBeNull();
    expect(body.haUser).toBeNull();
  });
});

describe('serving the web app under an ingress prefix', () => {
  function envWithWeb() {
    const webDir = mkdtempSync(join(tmpdir(), 'budget-web-'));
    writeFileSync(
      join(webDir, 'index.html'),
      '<!doctype html><html><head><title>t</title><script type="module" src="./assets/app.js"></script></head><body></body></html>',
    );
    return createTestEnv({ config: { webDir } });
  }

  it('serves index.html with only relative asset URLs', async () => {
    const res = await envWithWeb().app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('src="./assets/app.js"');
    expect(res.body).not.toMatch(/(src|href)="\/(?!\/)/);
    expect(res.body).not.toContain('<base');
  });

  it('injects a base href from the X-Ingress-Path header', async () => {
    const res = await envWithWeb().app.inject({
      method: 'GET',
      url: '/',
      headers: { 'x-ingress-path': '/api/hassio_ingress/abc123_-XY' },
    });
    expect(res.body).toContain('<base href="/api/hassio_ingress/abc123_-XY/" />');
  });

  it('ignores a malformed ingress path rather than injecting it', async () => {
    const res = await envWithWeb().app.inject({
      method: 'GET',
      url: '/',
      headers: { 'x-ingress-path': '/"><script>alert(1)</script>' },
    });
    expect(res.body).not.toContain('<base');
    expect(res.body).not.toContain('alert(1)');
  });
});
