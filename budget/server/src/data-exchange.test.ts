import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ApiError, DashboardDto, ExpenseDto, SavingsOverviewDto } from '@budget/shared';
import { openDatabase } from './db/connection.js';
import { exportBackup, restoreBackup, type Backup } from './services/backup.js';
import { formatCsv, normalizeName, parseAmountCents, parseCsv, parseDateFlexible } from './services/csv.js';
import type { ImportReport } from './services/data-csv.js';
import { api, categoryByName, createTestEnv, expenseBody, seedExample, type TestEnv } from './test-helpers.js';

async function setup(): Promise<TestEnv> {
  const env = createTestEnv();
  await seedExample(env);
  return env;
}

async function csvPost(env: TestEnv, url: string, csv: string): Promise<{ status: number; body: ImportReport & ApiError }> {
  const res = await env.app.inject({ method: 'POST', url, headers: { 'content-type': 'text/csv' }, payload: csv });
  return { status: res.statusCode, body: res.json() };
}

describe('csv helpers', () => {
  it('parses quoted fields, escaped quotes, embedded delimiters and newlines', () => {
    const rows = parseCsv('a;b;c\r\n"x;y";"say ""hi""";"line1\nline2"\r\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x;y', 'say "hi"', 'line1\nline2'],
    ]);
  });

  it('detects the comma delimiter, strips the BOM and skips blank lines', () => {
    expect(parseCsv('﻿a,b\n1,2\n\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('keeps empty trailing cells', () => {
    expect(parseCsv('a;b;c\n1;;')).toEqual([['a', 'b', 'c'], ['1', '', '']]);
  });

  it('rejects an unterminated quote', () => {
    expect(() => parseCsv('a;b\n"oops;1')).toThrow(/Guillemet/);
  });

  it('round-trips through formatCsv', () => {
    const rows = [['n', 'note'], ['1', 'a;b "c"\nd'], ['2', '']];
    expect(parseCsv(formatCsv(rows))).toEqual(rows);
  });

  it('parses amounts, dates and names leniently', () => {
    expect(parseAmountCents('12,50')).toBe(1250);
    expect(parseAmountCents('1 234.5 €')).toBe(123450);
    expect(parseAmountCents('abc')).toBeNull();
    expect(parseAmountCents('1,234')).toBeNull();
    expect(parseDateFlexible('05/10/2026')).toBe('2026-10-05');
    expect(parseDateFlexible('2026-10-05')).toBe('2026-10-05');
    expect(parseDateFlexible('hier')).toBeNull();
    expect(normalizeName('  Électricité  ')).toBe('electricite');
  });
});

describe('JSON backup and restore', () => {
  it('restores the exact state of a backup, including after later changes', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    await api(env, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p1', amountCents: 4200, tags: ['bio'], note: 'marché' }));
    await api(env, 'POST', '/api/settlements', { date: '2026-10-20', fromId: 'p2', toId: 'p1', amountCents: 1000 });

    const backup = (await api<Backup>(env, 'GET', '/api/backup')).body;
    const before = (await api<DashboardDto>(env, 'GET', '/api/months/2026-10/dashboard')).body;

    await api(env, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p2', amountCents: 99900 }));
    const restored = await api<{ rows: number }>(env, 'POST', '/api/backup/restore', { confirm: 'RESTAURER', backup });
    expect(restored.status).toBe(200);
    expect(restored.body.rows).toBeGreaterThan(50);

    expect((await api<DashboardDto>(env, 'GET', '/api/months/2026-10/dashboard')).body).toEqual(before);
    const [expense] = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?q=marché')).body;
    expect(expense).toMatchObject({ amountCents: 4200, tags: ['bio'] });
  });

  it('can rebuild an empty installation from a backup', async () => {
    const source = await setup();
    const food = await categoryByName(source, 'Courses');
    await api(source, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p1', amountCents: 4200 }));
    const backup = (await api<Backup>(source, 'GET', '/api/backup')).body;

    const target = createTestEnv();
    expect((await api(target, 'POST', '/api/backup/restore', { confirm: 'RESTAURER', backup })).status).toBe(200);
    expect((await api<{ needsSetup: boolean }>(target, 'GET', '/api/session')).body.needsSetup).toBe(false);
    expect((await api<DashboardDto>(target, 'GET', '/api/months/2026-10/dashboard')).body).toEqual(
      (await api<DashboardDto>(source, 'GET', '/api/months/2026-10/dashboard')).body,
    );
  });

  it('requires the confirmation word', async () => {
    const env = await setup();
    const backup = (await api<Backup>(env, 'GET', '/api/backup')).body;
    expect((await api(env, 'POST', '/api/backup/restore', { backup })).status).toBe(400);
    expect((await api(env, 'POST', '/api/backup/restore', { confirm: 'oui', backup })).status).toBe(400);
  });

  it('refuses a file that is not a backup', async () => {
    const env = await setup();
    const res = await api(env, 'POST', '/api/backup/restore', { confirm: 'RESTAURER', backup: { hello: 'world' } });
    expect(res.status).toBe(400);
  });

  it('refuses a backup from a newer schema', async () => {
    const env = await setup();
    const backup = (await api<Backup>(env, 'GET', '/api/backup')).body;
    const res = await api<ApiError>(env, 'POST', '/api/backup/restore', { confirm: 'RESTAURER', backup: { ...backup, schemaVersion: backup.schemaVersion + 1 } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('backup_too_new');
  });

  it('leaves the data untouched when a backup is inconsistent', async () => {
    const env = await setup();
    const backup = (await api<Backup>(env, 'GET', '/api/backup')).body;
    const before = (await api<DashboardDto>(env, 'GET', '/api/months/2026-10/dashboard')).body;
    const broken: Backup = { ...backup, tables: { ...backup.tables, categories: [] } };
    const res = await api<ApiError>(env, 'POST', '/api/backup/restore', { confirm: 'RESTAURER', backup: broken });
    expect(res.status).toBe(400);
    expect((await api<DashboardDto>(env, 'GET', '/api/months/2026-10/dashboard')).body).toEqual(before);
  });

  it('rejects unknown tables rather than guessing', async () => {
    const env = await setup();
    const backup = (await api<Backup>(env, 'GET', '/api/backup')).body;
    const res = await api(env, 'POST', '/api/backup/restore', { confirm: 'RESTAURER', backup: { ...backup, tables: { ...backup.tables, sqlite_master: [{ name: 'x' }] } } });
    expect(res.status).toBe(400);
  });

  it('accepts a backup that lacks columns added later, using their defaults', async () => {
    const env = await setup();
    const backup = (await api<Backup>(env, 'GET', '/api/backup')).body;
    const older: Backup = {
      ...backup,
      schemaVersion: 1,
      tables: { ...backup.tables, months: (backup.tables.months ?? []).map(({ fixed_enabled: _omit, ...rest }) => rest) },
    };
    expect((await api(env, 'POST', '/api/backup/restore', { confirm: 'RESTAURER', backup: older })).status).toBe(200);
  });

  it('writes a safety copy of the database before replacing it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'budget-restore-'));
    const path = join(dir, 'budget.db');
    const db = openDatabase(path);
    db.prepare("INSERT INTO settings (key, value) VALUES ('k', '1')").run();
    const backup = exportBackup(db);
    const result = restoreBackup(db, backup, path);
    expect(result.safetyCopy).not.toBeNull();
    expect(existsSync(result.safetyCopy ?? '')).toBe(true);
    db.close();
  });
});

describe('expenses CSV', () => {
  it('exports with a BOM, semicolons and decimal commas', async () => {
    const env = await setup();
    const food = await categoryByName(env, 'Courses');
    await api(env, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p2', amountCents: 4250, tags: ['bio', 'marché'], note: 'a;b' }));
    const res = await env.app.inject({ method: 'GET', url: '/api/export/expenses.csv?month=2026-10' });
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('depenses-2026-10.csv');
    expect(res.body.startsWith('﻿date;montant;categorie')).toBe(true);
    expect(res.body).toContain('2026-10-15;42,50;Courses;;Sam;revenus;bio|marché;"a;b";confirmée');
  });

  it('round-trips into another installation', async () => {
    const source = await setup();
    const food = await categoryByName(source, 'Courses');
    const fun = await categoryByName(source, 'Loisirs');
    await api(source, 'POST', '/api/expenses', expenseBody({ categoryId: food.id, payerId: 'p2', amountCents: 4250, tags: ['bio'], note: 'marché' }));
    await api(source, 'POST', '/api/expenses', expenseBody({ categoryId: fun.id, payerId: 'p1', amountCents: 3000, splitMode: 'equal', date: '2026-09-12' }));
    await api(source, 'POST', '/api/expenses', expenseBody({ categoryId: fun.id, payerId: 'p1', amountCents: 2000, splitMode: 'single', singleId: 'p2', date: '2026-09-13' }));
    await api(source, 'POST', '/api/expenses', expenseBody({ categoryId: fun.id, payerId: 'p1', amountCents: 1001, splitMode: 'custom', customBp: { p1: 6000, p2: 4000 }, date: '2026-09-14' }));
    const csv = (await source.app.inject({ method: 'GET', url: '/api/export/expenses.csv' })).body;

    const target = await setup();
    const imported = await csvPost(target, '/api/import/expenses', csv);
    expect(imported.status).toBe(200);
    expect(imported.body.errors).toEqual([]);
    // the 5 "à confirmer" fixed expenses are placeholders the app regenerates itself: not imported
    expect(imported.body).toMatchObject({ imported: 4, skipped: 5 });
    expect((await api<ExpenseDto[]>(target, 'GET', '/api/expenses?status=pending')).body).toHaveLength(5);

    const sourceList = (await api<ExpenseDto[]>(source, 'GET', '/api/expenses')).body;
    const targetList = (await api<ExpenseDto[]>(target, 'GET', '/api/expenses')).body;
    const key = (e: ExpenseDto): string => `${e.date}|${e.amountCents}|${e.payerId}|${e.splitMode}|${e.note}|${e.tags.join(',')}|${JSON.stringify(e.shares)}`;
    const manualSource = sourceList.filter((e) => !e.auto).map(key).sort();
    const manualTarget = targetList.filter((e) => !e.auto).map(key).sort();
    expect(manualTarget).toEqual(manualSource);
  });

  it('validates without writing during a dry run', async () => {
    const env = await setup();
    const before = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses')).body.length;
    const res = await csvPost(env, '/api/import/expenses?dryRun=true', 'date;montant;categorie\n2026-10-02;12,50;Courses\n03/10/2026;8;Loisirs');
    expect(res.body).toMatchObject({ dryRun: true, imported: 2, errors: [] });
    expect((await api<ExpenseDto[]>(env, 'GET', '/api/expenses')).body).toHaveLength(before);
  });

  it('imports flexible dates, amounts, names and split labels', async () => {
    const env = await setup();
    const csv = [
      'Date;Montant;Catégorie;Sous-ligne;Payé par;Répartition;Tags;Note',
      '05/10/2026;1 234,50 €;courses;;sam;50/50;a, b;en lot',
      '2026-10-06;9.99;ANIMAUX;vétérinaire;Alex;100% Sam;;',
      '2026-10-07;10;Loisirs;;;60/40;;',
    ].join('\n');
    const res = await csvPost(env, '/api/import/expenses', csv);
    expect(res.body).toMatchObject({ imported: 3, errors: [] });
    const list = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses?month=2026-10')).body.filter((e) => !e.auto);
    const first = list.find((e) => e.amountCents === 123450);
    expect(first).toMatchObject({ payerId: 'p2', splitMode: 'equal', tags: ['a', 'b'], note: 'en lot', date: '2026-10-05' });
    expect(list.find((e) => e.amountCents === 999)).toMatchObject({ splitMode: 'single', singleId: 'p2' });
    expect(list.find((e) => e.amountCents === 1000)).toMatchObject({ splitMode: 'custom', payerId: 'p1', customBp: { p1: 6000, p2: 4000 } });
  });

  it('reports every bad line and imports nothing', async () => {
    const env = await setup();
    const before = (await api<ExpenseDto[]>(env, 'GET', '/api/expenses')).body.length;
    const csv = [
      'date;montant;categorie;paye_par;repartition',
      '2026-10-02;12,50;Courses;;',
      'demain;12;Courses;;',
      '2026-10-03;zéro;Courses;;',
      '2026-10-04;5;Inconnue;;',
      '2026-10-05;5;Courses;Zoé;',
      '2026-10-06;5;Courses;;70/20',
    ].join('\n');
    const res = await csvPost(env, '/api/import/expenses', csv);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7]);
    expect(res.body.errors[2]?.message).toContain('Catégorie inconnue');
    expect((await api<ExpenseDto[]>(env, 'GET', '/api/expenses')).body).toHaveLength(before);
  });

  it('rejects a file without the required columns or with an unterminated quote', async () => {
    const env = await setup();
    const missing = await csvPost(env, '/api/import/expenses', 'date;montant\n2026-10-02;5');
    expect(missing.status).toBe(400);
    expect(missing.body.message).toContain('categorie');
    expect((await csvPost(env, '/api/import/expenses', 'date;montant;categorie\n"2026;5;Courses')).status).toBe(400);
  });

  it('does not import into archived categories', async () => {
    const env = await setup();
    const fun = await categoryByName(env, 'Loisirs');
    await api(env, 'PATCH', `/api/categories/${fun.id}`, { archived: true });
    const res = await csvPost(env, '/api/import/expenses', 'date;montant;categorie\n2026-10-02;5;Loisirs');
    expect(res.body.errors[0]?.message).toContain('Catégorie inconnue');
  });
});

describe('savings CSV', () => {
  it('round-trips contributions and balances', async () => {
    const source = await setup();
    const livret = (await api<SavingsOverviewDto>(source, 'GET', '/api/savings')).body.accounts.find((a) => a.name === 'Livret A');
    await api(source, 'PUT', '/api/savings/entries', { accountId: livret?.id, month: '2026-09', contributionCents: 50000, balanceCents: 123456, note: 'prime' });
    await api(source, 'PUT', '/api/savings/entries', { accountId: livret?.id, month: '2026-10', contributionCents: -2000, balanceCents: null });
    const csv = (await source.app.inject({ method: 'GET', url: '/api/export/savings.csv' })).body;
    expect(csv).toContain('Livret A;2026-09;500,00;1234,56;prime');

    const target = await setup();
    const res = await csvPost(target, '/api/import/savings', csv);
    expect(res.body).toMatchObject({ imported: 2, errors: [] });
    const entries = (await api<SavingsOverviewDto>(target, 'GET', '/api/savings')).body.entries;
    expect(entries.map((e) => [e.month, e.contributionCents, e.balanceCents, e.note])).toEqual([
      ['2026-09', 50000, 123456, 'prime'],
      ['2026-10', -2000, null, ''],
    ]);
  });

  it('accepts MM/YYYY months and reports unknown accounts without importing', async () => {
    const env = await setup();
    const ok = await csvPost(env, '/api/import/savings', 'compte;mois;versement\nPEA;09/2026;100');
    expect(ok.body.imported).toBe(1);
    const bad = await csvPost(env, '/api/import/savings', 'compte;mois;versement\nPEA;10/2026;50\nBitcoin;2026-10;10\nPEA;oct;5');
    expect(bad.body.imported).toBe(0);
    expect(bad.body.errors.map((e) => e.line)).toEqual([3, 4]);
    expect((await api<SavingsOverviewDto>(env, 'GET', '/api/savings')).body.entries).toHaveLength(1);
  });
});
