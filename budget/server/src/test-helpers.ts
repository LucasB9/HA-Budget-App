import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { CategoryDto, ExpenseInput, GroupDto } from '@budget/shared';
import { buildApp } from './app.js';
import type { AppConfig } from './config.js';
import type { AppContext } from './context.js';
import { openDatabase } from './db/connection.js';

export const EXAMPLE_SEED_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../seed.example.json');

export function loadExampleSeed(): Record<string, unknown> {
  return JSON.parse(readFileSync(EXAMPLE_SEED_PATH, 'utf8')) as Record<string, unknown>;
}

export interface TestEnv {
  app: FastifyInstance;
  ctx: AppContext;
  setNow: (iso: string) => void;
}

export function createTestEnv(opts: { now?: string; config?: Partial<AppConfig> } = {}): TestEnv {
  let now = new Date(opts.now ?? '2026-10-15T10:00:00Z');
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dbPath: ':memory:',
    webDir: '/nonexistent',
    seedExamplePath: EXAMPLE_SEED_PATH,
    anthropicApiKey: null,
    anthropicModel: 'test-model',
    enforceIngress: false,
    supervisorToken: null,
    shortcutToken: null,
    version: 'test',
    ...opts.config,
  };
  const ctx: AppContext = { db: openDatabase(':memory:'), config, now: () => now };
  return { app: buildApp(ctx), ctx, setNow: (iso) => (now = new Date(iso)) };
}

export async function api<T = unknown>(
  env: TestEnv,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await env.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const text = res.body;
  return { status: res.statusCode, body: (text ? JSON.parse(text) : undefined) as T };
}

export async function seedExample(env: TestEnv): Promise<void> {
  const res = await api(env, 'POST', '/api/setup/seed', loadExampleSeed());
  if (res.status !== 201) throw new Error(`seed failed: ${JSON.stringify(res.body)}`);
}

export async function catalog(env: TestEnv): Promise<GroupDto[]> {
  return (await api<GroupDto[]>(env, 'GET', '/api/catalog')).body;
}

export async function categoryByName(env: TestEnv, name: string): Promise<CategoryDto> {
  const found = (await catalog(env)).flatMap((g) => g.categories).find((c) => c.name === name);
  if (!found) throw new Error(`category not found: ${name}`);
  return found;
}

export function expenseBody(overrides: Partial<ExpenseInput> & Pick<ExpenseInput, 'categoryId' | 'payerId'>): ExpenseInput {
  return {
    date: '2026-10-15',
    amountCents: 10000,
    subcategoryId: null,
    splitMode: 'income',
    singleId: null,
    customBp: null,
    tags: [],
    note: '',
    ...overrides,
  };
}
