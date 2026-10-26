import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiError, ExpenseDto, RecapDto, SessionDto } from '@budget/shared';
import { AiError, type AiClient, type AiRequest, type AiResult } from './ai/client.js';
import { resetAutoRecapState, runAutoRecap } from './services/recap.js';
import { api, categoryByName, createTestEnv, expenseBody, seedExample, type TestEnv } from './test-helpers.js';

const RECAP_TEXT = "## Ce qui s'est bien passé\nTout va bien.";

interface FakeAi extends AiClient {
  requests: AiRequest[];
}

function fakeAi(behaviour: (req: AiRequest) => Promise<AiResult> = async () => ({ text: RECAP_TEXT, model: 'fake-model-1', inputTokens: 1200, outputTokens: 400 })): FakeAi {
  const requests: AiRequest[] = [];
  return {
    requests,
    async generate(req) {
      requests.push(req);
      return behaviour(req);
    },
  };
}

async function setup(ai: AiClient | null, now = '2026-10-15T10:00:00Z'): Promise<TestEnv> {
  const env = createTestEnv({ now, ai, config: { anthropicModel: 'claude-opus-5-5', anthropicApiKey: ai ? 'sk-test-secret' : null } });
  await seedExample(env);
  return env;
}

async function spend(env: TestEnv, name: string, amountCents: number, date: string, extra: object = {}): Promise<ExpenseDto> {
  const c = await categoryByName(env, name);
  const res = await api<ExpenseDto>(env, 'POST', '/api/expenses', expenseBody({ categoryId: c.id, payerId: 'p1', amountCents, date, ...extra }));
  expect(res.status).toBe(201);
  return res.body;
}

const sentPayload = (ai: FakeAi): Record<string, unknown> => {
  const user = ai.requests.at(-1)?.user ?? '';
  const json = user.slice(user.indexOf('```json') + 7, user.lastIndexOf('```'));
  return JSON.parse(json) as Record<string, unknown>;
};

beforeEach(() => resetAutoRecapState());

describe('generating a recap', () => {
  it('fails gracefully when no API key is configured', async () => {
    const env = await setup(null);
    const res = await api<ApiError>(env, 'POST', '/api/recaps', { month: '2026-10' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ai_not_configured');
    expect((await api<RecapDto[]>(env, 'GET', '/api/recaps')).body).toEqual([]);
  });

  it('stores the recap with its model, tokens and trigger, and lists the history newest first', async () => {
    const ai = fakeAi();
    const env = await setup(ai);
    const first = await api<RecapDto>(env, 'POST', '/api/recaps', { month: '2026-10' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ month: '2026-10', trigger: 'manual', content: RECAP_TEXT, model: 'fake-model-1', inputTokens: 1200, outputTokens: 400 });

    env.setNow('2026-10-16T10:00:00Z');
    await api(env, 'POST', '/api/recaps', { month: '2026-10' });
    const history = (await api<RecapDto[]>(env, 'GET', '/api/recaps?month=2026-10')).body;
    expect(history).toHaveLength(2);
    expect((history[0]?.createdAt ?? '') >= (history[1]?.createdAt ?? '')).toBe(true);
    expect((await api<RecapDto[]>(env, 'GET', '/api/recaps?month=2026-09')).body).toEqual([]);
  });

  it('uses the configured model and asks for a French recap with the required sections', async () => {
    const ai = fakeAi();
    const env = await setup(ai);
    await api(env, 'POST', '/api/recaps', { month: '2026-10' });
    const req = ai.requests[0];
    expect(req?.model).toBe('claude-opus-5-5');
    expect(req?.maxTokens).toBeGreaterThanOrEqual(4000);
    for (const title of ['Ce qui s\'est bien passé', 'Catégories au-dessus du budget', 'Dépenses inhabituelles', 'Suggestions pour le mois prochain', 'Épargne']) {
      expect(req?.system).toContain(`## ${title}`);
    }
  });

  it('rejects an unknown month and an invalid body', async () => {
    const env = await setup(fakeAi());
    expect((await api(env, 'POST', '/api/recaps', { month: '2027-05' })).status).toBe(404);
    expect((await api(env, 'POST', '/api/recaps', { month: 'octobre' })).status).toBe(400);
  });

  it.each([
    ['rate_limit', 429, 'ai_rate_limit'],
    ['auth', 502, 'ai_auth'],
    ['refusal', 502, 'ai_refused'],
    ['network', 502, 'ai_error'],
  ] as const)('maps an AI %s error to HTTP %i and stores nothing', async (kind, status, code) => {
    const env = await setup(fakeAi(async () => { throw new AiError(kind, 'boom'); }));
    const res = await api<ApiError>(env, 'POST', '/api/recaps', { month: '2026-10' });
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(code);
    expect((await api<RecapDto[]>(env, 'GET', '/api/recaps')).body).toEqual([]);
  });

  it('refuses a second generation of the same month while one is running', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ai = fakeAi(async () => { await gate; return { text: RECAP_TEXT, model: 'm', inputTokens: 1, outputTokens: 1 }; });
    const env = await setup(ai);
    const first = api<RecapDto>(env, 'POST', '/api/recaps', { month: '2026-10' });
    await new Promise((r) => setTimeout(r, 20));
    const second = await api<ApiError>(env, 'POST', '/api/recaps', { month: '2026-10' });
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(201);
    expect(ai.requests).toHaveLength(1);
  });

  it('never exposes the API key', async () => {
    const env = await setup(fakeAi());
    const session = await env.app.inject({ method: 'GET', url: '/api/session' });
    expect(session.json<SessionDto>().aiConfigured).toBe(true);
    expect(session.body).not.toContain('sk-test-secret');
  });
});

describe('data sent to the model', () => {
  it('contains budget vs spent per category and the notes of notable expenses', async () => {
    const ai = fakeAi();
    const env = await setup(ai);
    await spend(env, 'Courses', 45000, '2026-10-12', { note: 'fête des voisins', tags: ['fête'] });
    await api(env, 'POST', '/api/recaps', { month: '2026-10' });
    const payload = sentPayload(ai) as {
      mois: string;
      categories: { categorie: string; budgetPrevu: number; depense: number; reste: number; statut: string }[];
      depensesNotables: { categorie: string; montant: number; note?: string; tags?: string[]; payePar: string }[];
      tags: { tag: string; total: number }[];
    };
    expect(payload.mois).toBe('octobre 2026');
    expect(payload.categories.find((c) => c.categorie === 'Courses')).toMatchObject({ budgetPrevu: 400, depense: 450, reste: -50, statut: 'budget atteint ou dépassé' });
    expect(payload.depensesNotables[0]).toMatchObject({ categorie: 'Courses', montant: 450, note: 'fête des voisins', tags: ['fête'], payePar: 'Alex' });
    expect(payload.tags).toEqual([{ tag: 'fête', total: 450, nombreDeDepenses: 1 }]);
  });

  it('compares with the previous months to flag unusual spending', async () => {
    const ai = fakeAi();
    const env = await setup(ai);
    await spend(env, 'Loisirs', 10000, '2026-08-10');
    await spend(env, 'Loisirs', 30000, '2026-09-10');
    await spend(env, 'Loisirs', 45000, '2026-10-10');
    await api(env, 'POST', '/api/recaps', { month: '2026-10' });
    const payload = sentPayload(ai) as { categories: Record<string, unknown>[] };
    expect(payload.categories.find((c) => c.categorie === 'Loisirs')).toMatchObject({
      moisPrecedent: 300,
      moyenneDesMoisPrecedents: 200,
      nombreDeMoisCompares: 2,
      nettementAuDessusDeLaMoyenne: true,
    });
  });

  it('leaves out recurring fixed expenses that have no note', async () => {
    const ai = fakeAi();
    const env = await setup(ai);
    const [pending] = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?status=pending&q=Loyer')).body;
    await api(env, 'POST', `/api/expenses/${pending?.id}/confirm`, {});
    await spend(env, 'Courses', 5000, '2026-10-12');
    await api(env, 'POST', '/api/recaps', { month: '2026-10' });
    const payload = sentPayload(ai) as { depensesNotables: { categorie: string }[] };
    expect(payload.depensesNotables.map((e) => e.categorie)).toEqual(['Courses']);
  });

  it('includes savings and the balance between the two people', async () => {
    const ai = fakeAi();
    const env = await setup(ai);
    const livret = (await api<{ accounts: { id: string; name: string }[] }>(env, 'GET', '/api/savings')).body.accounts.find((a) => a.name === 'Livret A');
    await api(env, 'PUT', '/api/savings/entries', { accountId: livret?.id, month: '2026-10', contributionCents: 100000, balanceCents: 250000, note: 'prime' });
    await spend(env, 'Courses', 10000, '2026-10-12', { splitMode: 'equal' });
    await api(env, 'POST', '/api/recaps', { month: '2026-10' });

    const payload = sentPayload(ai) as {
      epargne: { versementsDuMois: number; tauxDEpargneEnPourcent: number; comptes: Record<string, unknown>[] };
      equilibreEntreLesDeux: { soldeDuMois: string; depensesFixesAConfirmerNonComptees: { nombre: number } };
      foyer: { repartitionSelonLesRevenusEnPourcent: Record<string, number> };
    };
    expect(payload.epargne.versementsDuMois).toBe(1000);
    expect(payload.epargne.tauxDEpargneEnPourcent).toBe(25);
    expect(payload.epargne.comptes.find((c) => c.nom === 'Livret A')).toMatchObject({ versementDuMois: 1000, soldeFinDeMois: 2500, note: 'prime' });
    expect(payload.equilibreEntreLesDeux.soldeDuMois).toBe('Sam doit 50 € à Alex');
    expect(payload.equilibreEntreLesDeux.depensesFixesAConfirmerNonComptees.nombre).toBe(5);
    expect(payload.foyer.repartitionSelonLesRevenusEnPourcent).toEqual({ Alex: 75, Sam: 25 });
  });

  it('never contains internal identifiers, account numbers or the API key', async () => {
    const ai = fakeAi();
    const env = await setup(ai);
    const expense = await spend(env, 'Courses', 5000, '2026-10-12');
    await api(env, 'POST', '/api/recaps', { month: '2026-10' });
    const sent = ai.requests[0]?.user ?? '';
    const category = await categoryByName(env, 'Courses');
    expect(sent).not.toContain(expense.id);
    expect(sent).not.toContain(category.id);
    expect(sent).not.toContain('sk-test-secret');
    expect(sent).not.toMatch(/"(id|accountId|categoryId|payerId)"/);
  });

  it('marks an unfinished month as provisional and projects its end', async () => {
    const ai = fakeAi();
    const env = await setup(ai);
    await api(env, 'POST', '/api/recaps', { month: '2026-10' });
    const payload = sentPayload(ai) as { moisTermine: boolean; totaux: Record<string, number> };
    expect(payload.moisTermine).toBe(false);
    expect(payload.totaux.projectionFinDeMois).toBeTypeOf('number');
  });

  it('exposes the exact payload through a preview endpoint', async () => {
    const env = await setup(fakeAi());
    const res = await api<{ mois: string; categories: unknown[] }>(env, 'GET', '/api/recaps/preview?month=2026-10');
    expect(res.status).toBe(200);
    expect(res.body.mois).toBe('octobre 2026');
    expect(res.body.categories.length).toBeGreaterThan(5);
    expect((await api(env, 'GET', '/api/recaps/preview?month=2030-01')).status).toBe(404);
  });
});

describe('automatic monthly recap', () => {
  async function monthEnd(ai: AiClient | null, autoRecap = true): Promise<TestEnv> {
    const env = await setup(ai);
    await spend(env, 'Courses', 5000, '2026-10-12');
    await api(env, 'PATCH', '/api/settings', { autoRecap });
    env.setNow('2026-11-02T08:00:00Z');
    await api(env, 'GET', '/api/session'); // creates November
    return env;
  }

  it('writes the recap of the previous month on the first days of the month, once', async () => {
    const ai = fakeAi();
    const env = await monthEnd(ai);
    const recap = await runAutoRecap(env.ctx);
    expect(recap).toMatchObject({ month: '2026-10', trigger: 'auto' });
    expect(await runAutoRecap(env.ctx)).toBeNull();
    expect(ai.requests).toHaveLength(1);
  });

  it('does nothing when the setting is off, there is no key, or the month is not early', async () => {
    const off = fakeAi();
    expect(await runAutoRecap((await monthEnd(off, false)).ctx)).toBeNull();
    expect(off.requests).toHaveLength(0);

    expect(await runAutoRecap((await monthEnd(null)).ctx)).toBeNull();

    const late = fakeAi();
    const env = await monthEnd(late);
    env.setNow('2026-11-20T08:00:00Z');
    expect(await runAutoRecap(env.ctx)).toBeNull();
    expect(late.requests).toHaveLength(0);
  });

  it('skips a month that already has a recap', async () => {
    const ai = fakeAi();
    const env = await monthEnd(ai);
    await api(env, 'POST', '/api/recaps', { month: '2026-10' });
    expect(await runAutoRecap(env.ctx)).toBeNull();
    expect(ai.requests).toHaveLength(1);
  });

  it('skips a month in which nothing was spent', async () => {
    const ai = fakeAi();
    const env = createTestEnv({ now: '2026-10-15T10:00:00Z', ai, config: { anthropicApiKey: 'sk-test' } });
    const seed = { version: 1, people: [{ name: 'A', monthlyIncome: 10 }, { name: 'B', monthlyIncome: 10 }], groups: [{ name: 'G', categories: [{ name: 'C', amount: 10, type: 'variable' }] }] };
    expect((await api(env, 'POST', '/api/setup/seed', seed)).status).toBe(201);
    await api(env, 'PATCH', '/api/settings', { autoRecap: true });
    env.setNow('2026-11-02T08:00:00Z');
    await api(env, 'GET', '/api/session');
    expect(await runAutoRecap(env.ctx)).toBeNull();
    expect(ai.requests).toHaveLength(0);
  });

  it('spaces out retries after a failure', async () => {
    let fail = true;
    const ai = fakeAi(async () => {
      if (fail) throw new AiError('network', 'down');
      return { text: RECAP_TEXT, model: 'm', inputTokens: 1, outputTokens: 1 };
    });
    const env = await monthEnd(ai);
    await expect(runAutoRecap(env.ctx)).rejects.toThrow();
    env.setNow('2026-11-02T09:00:00Z');
    expect(await runAutoRecap(env.ctx)).toBeNull(); // too soon
    expect(ai.requests).toHaveLength(1);

    fail = false;
    env.setNow('2026-11-02T15:00:00Z');
    expect(await runAutoRecap(env.ctx)).toMatchObject({ month: '2026-10' });
  });
});
