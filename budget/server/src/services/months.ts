import {
  ratioFromWeights,
  resolveMonthWeights,
  type Cents,
  type IncomeDto,
  type MonthDto,
  type MonthKey,
} from '@budget/shared';
import { newId, nowIso, type Db } from '../db/connection.js';
import { notFound } from '../errors.js';
import { personIds } from './people.js';

interface LeafLine {
  subcategoryId: string | null;
  plannedCents: Cents;
}

export function monthExists(db: Db, month: MonthKey): boolean {
  return db.prepare('SELECT 1 FROM months WHERE month = ?').get(month) !== undefined;
}

export function requireMonth(db: Db, month: MonthKey): void {
  if (!monthExists(db, month)) throw notFound(`Month not created yet: ${month}`, 'month_not_found');
}

export function previousMonth(db: Db, month: MonthKey): MonthKey | null {
  const row = db.prepare('SELECT MAX(month) AS m FROM months WHERE month < ?').get(month) as { m: string | null };
  return row.m;
}

export function listMonthKeys(db: Db): MonthKey[] {
  return (db.prepare('SELECT month FROM months ORDER BY month').all() as { month: string }[]).map((r) => r.month);
}

/** The budget lines a category should have: one per active sub-line, or a single line for the category. */
function leafLines(db: Db, categoryId: string, categoryPlanned: Cents): LeafLine[] {
  const subs = db
    .prepare('SELECT id, planned_cents FROM subcategories WHERE category_id = ? AND archived = 0 ORDER BY position')
    .all(categoryId) as { id: string; planned_cents: number }[];
  if (subs.length > 0) return subs.map((s) => ({ subcategoryId: s.id, plannedCents: s.planned_cents }));
  return [{ subcategoryId: null, plannedCents: categoryPlanned }];
}

function activeCategories(db: Db): { id: string; planned_cents: number }[] {
  return db
    .prepare(
      `SELECT c.id, c.planned_cents FROM categories c JOIN groups g ON g.id = c.group_id
       WHERE c.archived = 0 AND g.archived = 0 ORDER BY g.position, c.position`,
    )
    .all() as { id: string; planned_cents: number }[];
}

function insertLine(db: Db, month: MonthKey, categoryId: string, line: LeafLine): void {
  db.prepare(
    'INSERT INTO budget_lines (id, month, category_id, subcategory_id, planned_cents) VALUES (?, ?, ?, ?, ?)',
  ).run(newId(), month, categoryId, line.subcategoryId, line.plannedCents);
}

function lineKey(categoryId: string, subcategoryId: string | null): string {
  return `${categoryId}|${subcategoryId ?? ''}`;
}

/**
 * Brings a month's budget lines in line with the catalog: adds missing lines (with the template
 * amount) and, when `prune` is set, drops lines that no longer match an active leaf.
 * Existing amounts are never touched, unless `overwrite` is set.
 */
export function reconcileLines(
  db: Db,
  month: MonthKey,
  opts: { prune: boolean; overwrite?: boolean },
): void {
  const existing = db
    .prepare('SELECT id, category_id, subcategory_id, planned_cents FROM budget_lines WHERE month = ?')
    .all(month) as { id: string; category_id: string; subcategory_id: string | null; planned_cents: number }[];
  const byKey = new Map(existing.map((l) => [lineKey(l.category_id, l.subcategory_id), l]));
  const wanted = new Set<string>();

  for (const cat of activeCategories(db)) {
    for (const leaf of leafLines(db, cat.id, cat.planned_cents)) {
      const key = lineKey(cat.id, leaf.subcategoryId);
      wanted.add(key);
      const current = byKey.get(key);
      if (!current) insertLine(db, month, cat.id, leaf);
      else if (opts.overwrite && current.planned_cents !== leaf.plannedCents) {
        db.prepare('UPDATE budget_lines SET planned_cents = ? WHERE id = ?').run(leaf.plannedCents, current.id);
      }
    }
  }
  if (opts.prune) {
    for (const [key, line] of byKey) {
      if (!wanted.has(key)) db.prepare('DELETE FROM budget_lines WHERE id = ?').run(line.id);
    }
  }
}

/** Applies catalog changes to the given month and every later one; earlier months stay untouched. */
export function syncOpenMonths(db: Db, fromMonth: MonthKey, opts: { overwrite: boolean }): void {
  const months = (db.prepare('SELECT month FROM months WHERE month >= ?').all(fromMonth) as { month: string }[]).map(
    (r) => r.month,
  );
  db.transaction(() => {
    for (const month of months) reconcileLines(db, month, { prune: true, overwrite: opts.overwrite });
  })();
}

export function getIncomes(db: Db, month: MonthKey): IncomeDto[] {
  const rows = db
    .prepare('SELECT person_id, amount_cents, note FROM month_incomes WHERE month = ?')
    .all(month) as { person_id: string; amount_cents: number; note: string }[];
  const byPerson = new Map(rows.map((r) => [r.person_id, r]));
  return personIds(db).map((id) => {
    const row = byPerson.get(id);
    return { personId: id, amountCents: row?.amount_cents ?? 0, note: row?.note ?? '' };
  });
}

export function getWeights(db: Db, month: MonthKey): Record<string, number> {
  const rows = db.prepare('SELECT person_id, weight FROM month_weights WHERE month = ?').all(month) as {
    person_id: string;
    weight: number;
  }[];
  const weights: Record<string, number> = Object.fromEntries(personIds(db).map((id) => [id, 0]));
  for (const r of rows) weights[r.person_id] = r.weight;
  return weights;
}

function writeWeights(db: Db, month: MonthKey, weights: Record<string, number>): void {
  const upsert = db.prepare(
    `INSERT INTO month_weights (month, person_id, weight) VALUES (?, ?, ?)
     ON CONFLICT(month, person_id) DO UPDATE SET weight = excluded.weight`,
  );
  for (const [id, weight] of Object.entries(weights)) upsert.run(month, id, weight);
}

/** Weights a month would get from its current incomes (falling back to the previous month's ratio). */
export function weightsFromIncomes(db: Db, month: MonthKey): Record<string, number> {
  const ids = personIds(db);
  const incomes = Object.fromEntries(getIncomes(db, month).map((i) => [i.personId, i.amountCents]));
  const prev = previousMonth(db, month);
  return resolveMonthWeights(incomes, ids, prev ? getWeights(db, prev) : null);
}

function sameRatio(a: Record<string, number>, b: Record<string, number>): boolean {
  const ids = Object.keys(a);
  const ta = ids.reduce((s, id) => s + (a[id] ?? 0), 0);
  const tb = ids.reduce((s, id) => s + (b[id] ?? 0), 0);
  return ids.every((id) => (a[id] ?? 0) * tb === (b[id] ?? 0) * ta);
}

/** Turns on fixed-expense generation for a month (explicit creation or the current month). */
export function enableFixed(db: Db, month: MonthKey): void {
  db.prepare('UPDATE months SET fixed_enabled = 1 WHERE month = ?').run(month);
}

/**
 * Creates a month by copying the previous one (or the template when there is none).
 * Incomes are copied, the income ratio is frozen from them. Returns true when created.
 */
export function ensureMonth(
  db: Db,
  month: MonthKey,
  opts: { incomes?: Record<string, Cents>; withFixed?: boolean } = {},
): boolean {
  if (monthExists(db, month)) {
    if (opts.withFixed) enableFixed(db, month);
    return false;
  }
  const ids = personIds(db);
  if (ids.length === 0) throw notFound('No household configured yet', 'setup_required');

  db.transaction(() => {
    const prev = previousMonth(db, month);
    db.prepare('INSERT INTO months (month, created_at, fixed_enabled) VALUES (?, ?, ?)').run(month, nowIso(), opts.withFixed ? 1 : 0);

    const incomes: Record<string, Cents> = {};
    const prevIncomes = prev ? getIncomes(db, prev) : [];
    for (const id of ids) {
      incomes[id] = opts.incomes?.[id] ?? prevIncomes.find((i) => i.personId === id)?.amountCents ?? 0;
    }
    const insertIncome = db.prepare(
      'INSERT INTO month_incomes (month, person_id, amount_cents, note) VALUES (?, ?, ?, ?)',
    );
    for (const id of ids) insertIncome.run(month, id, incomes[id], '');
    writeWeights(db, month, resolveMonthWeights(incomes, ids, prev ? getWeights(db, prev) : null));

    if (prev) {
      db.prepare(
        `INSERT INTO budget_lines (id, month, category_id, subcategory_id, planned_cents)
         SELECT lower(hex(randomblob(8))), ?, category_id, subcategory_id, planned_cents
         FROM budget_lines WHERE month = ?`,
      ).run(month, prev);
    }
    reconcileLines(db, month, { prune: true });
  })();
  return true;
}

export function getMonthDto(db: Db, month: MonthKey): MonthDto {
  requireMonth(db, month);
  const ids = personIds(db);
  const weights = getWeights(db, month);
  return {
    month,
    incomes: getIncomes(db, month),
    weights,
    ratio: ratioFromWeights(weights, ids),
    ratioStale: !sameRatio(weights, weightsFromIncomes(db, month)),
  };
}

export function updateIncomes(
  db: Db,
  month: MonthKey,
  incomes: { personId: string; amountCents: Cents; note: string }[],
): void {
  requireMonth(db, month);
  const ids = new Set(personIds(db));
  const upsert = db.prepare(
    `INSERT INTO month_incomes (month, person_id, amount_cents, note) VALUES (?, ?, ?, ?)
     ON CONFLICT(month, person_id) DO UPDATE SET amount_cents = excluded.amount_cents, note = excluded.note`,
  );
  db.transaction(() => {
    for (const income of incomes) {
      if (!ids.has(income.personId)) throw notFound(`Unknown person: ${income.personId}`, 'unknown_person');
      upsert.run(month, income.personId, income.amountCents, income.note);
    }
  })();
}

/** Re-freezes the month's weights from its current incomes. Share recomputation is done by the caller. */
export function refreezeWeights(db: Db, month: MonthKey): Record<string, number> {
  requireMonth(db, month);
  const weights = weightsFromIncomes(db, month);
  writeWeights(db, month, weights);
  return weights;
}

export function setBudgetLine(
  db: Db,
  month: MonthKey,
  input: { categoryId: string; subcategoryId: string | null; plannedCents: Cents; applyToTemplate: boolean },
): void {
  requireMonth(db, month);
  db.transaction(() => {
    const existing = db
      .prepare('SELECT id FROM budget_lines WHERE month = ? AND category_id = ? AND subcategory_id IS ?')
      .get(month, input.categoryId, input.subcategoryId) as { id: string } | undefined;
    if (existing) {
      db.prepare('UPDATE budget_lines SET planned_cents = ? WHERE id = ?').run(input.plannedCents, existing.id);
    } else {
      insertLine(db, month, input.categoryId, { subcategoryId: input.subcategoryId, plannedCents: input.plannedCents });
    }
    if (input.applyToTemplate) {
      if (input.subcategoryId) {
        db.prepare('UPDATE subcategories SET planned_cents = ? WHERE id = ?').run(input.plannedCents, input.subcategoryId);
      } else {
        db.prepare('UPDATE categories SET planned_cents = ? WHERE id = ?').run(input.plannedCents, input.categoryId);
      }
    }
  })();
}
