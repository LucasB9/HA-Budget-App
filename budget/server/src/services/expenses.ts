import {
  computeShares,
  monthOfDate,
  type Cents,
  type ExpenseDto,
  type ExpenseInput,
  type MonthKey,
  type SplitMode,
} from '@budget/shared';
import { newId, nowIso, type Db } from '../db/connection.js';
import { badRequest, notFound } from '../errors.js';
import { ensureMonth, getWeights, refreezeWeights } from './months.js';
import { personIds } from './people.js';

interface ExpenseRow {
  id: string;
  date: string;
  month: string;
  amount_cents: number;
  category_id: string;
  subcategory_id: string | null;
  payer_id: string;
  split_mode: SplitMode;
  single_id: string | null;
  custom_bp: string | null;
  note: string;
  status: 'confirmed' | 'pending';
  auto: number;
  created_by: string | null;
  created_at: string;
}

export interface ExpenseFilters {
  month?: string | undefined;
  categoryId?: string | undefined;
  tag?: string | undefined;
  personId?: string | undefined;
  q?: string | undefined;
  status?: 'confirmed' | 'pending' | undefined;
}

function buildWhere(filters: ExpenseFilters): { sql: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filters.month) {
    clauses.push('e.month = ?');
    params.push(filters.month);
  }
  if (filters.categoryId) {
    clauses.push('e.category_id = ?');
    params.push(filters.categoryId);
  }
  if (filters.personId) {
    clauses.push('e.payer_id = ?');
    params.push(filters.personId);
  }
  if (filters.status) {
    clauses.push('e.status = ?');
    params.push(filters.status);
  }
  if (filters.tag) {
    clauses.push(
      `EXISTS (SELECT 1 FROM expense_tags et JOIN tags t ON t.id = et.tag_id
               WHERE et.expense_id = e.id AND t.name = ? COLLATE NOCASE)`,
    );
    params.push(filters.tag);
  }
  if (filters.q) {
    const like = `%${filters.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    clauses.push(
      `(e.note LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM categories c WHERE c.id = e.category_id AND c.name LIKE ? ESCAPE '\\')
        OR EXISTS (SELECT 1 FROM expense_tags et JOIN tags t ON t.id = et.tag_id
                   WHERE et.expense_id = e.id AND t.name LIKE ? ESCAPE '\\'))`,
    );
    params.push(like, like, like);
  }
  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function toDto(row: ExpenseRow, shares: Record<string, Cents>, tags: string[]): ExpenseDto {
  return {
    id: row.id,
    date: row.date,
    month: row.month,
    amountCents: row.amount_cents,
    categoryId: row.category_id,
    subcategoryId: row.subcategory_id,
    payerId: row.payer_id,
    splitMode: row.split_mode,
    singleId: row.single_id,
    customBp: row.custom_bp ? (JSON.parse(row.custom_bp) as Record<string, number>) : null,
    shares,
    tags,
    note: row.note,
    status: row.status,
    auto: row.auto === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function listExpenses(db: Db, filters: ExpenseFilters, limit = 1000): ExpenseDto[] {
  const { sql, params } = buildWhere(filters);
  const rows = db
    .prepare(`SELECT e.* FROM expenses e ${sql} ORDER BY e.date DESC, e.created_at DESC LIMIT ?`)
    .all(...params, limit) as ExpenseRow[];
  if (rows.length === 0) return [];

  const idsSql = `SELECT e.id FROM expenses e ${sql} ORDER BY e.date DESC, e.created_at DESC LIMIT ?`;
  const shareRows = db
    .prepare(`SELECT expense_id, person_id, amount_cents FROM expense_shares WHERE expense_id IN (${idsSql})`)
    .all(...params, limit) as { expense_id: string; person_id: string; amount_cents: number }[];
  const tagRows = db
    .prepare(
      `SELECT et.expense_id, t.name FROM expense_tags et JOIN tags t ON t.id = et.tag_id
       WHERE et.expense_id IN (${idsSql}) ORDER BY t.name`,
    )
    .all(...params, limit) as { expense_id: string; name: string }[];

  const sharesBy = new Map<string, Record<string, Cents>>();
  for (const s of shareRows) {
    const entry = sharesBy.get(s.expense_id) ?? {};
    entry[s.person_id] = s.amount_cents;
    sharesBy.set(s.expense_id, entry);
  }
  const tagsBy = new Map<string, string[]>();
  for (const t of tagRows) {
    const list = tagsBy.get(t.expense_id) ?? [];
    list.push(t.name);
    tagsBy.set(t.expense_id, list);
  }
  return rows.map((r) => toDto(r, sharesBy.get(r.id) ?? {}, tagsBy.get(r.id) ?? []));
}

export function getExpense(db: Db, id: string): ExpenseDto {
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as ExpenseRow | undefined;
  if (!row) throw notFound(`Expense not found: ${id}`, 'expense_not_found');
  const shares = Object.fromEntries(
    (
      db.prepare('SELECT person_id, amount_cents FROM expense_shares WHERE expense_id = ?').all(id) as {
        person_id: string;
        amount_cents: number;
      }[]
    ).map((s) => [s.person_id, s.amount_cents]),
  );
  const tags = (
    db
      .prepare('SELECT t.name FROM expense_tags et JOIN tags t ON t.id = et.tag_id WHERE et.expense_id = ? ORDER BY t.name')
      .all(id) as { name: string }[]
  ).map((t) => t.name);
  return toDto(row, shares, tags);
}

interface SplitSpec {
  amountCents: Cents;
  payerId: string;
  splitMode: SplitMode;
  singleId: string | null;
  customBp: Record<string, number> | null;
}

function sharesFor(db: Db, month: MonthKey, spec: SplitSpec): Record<string, Cents> {
  const ids = personIds(db);
  try {
    return computeShares({
      mode: spec.splitMode,
      amountCents: spec.amountCents,
      payerId: spec.payerId,
      personIds: ids,
      incomeWeights: getWeights(db, month),
      ...(spec.singleId ? { singleId: spec.singleId } : {}),
      ...(spec.customBp ? { customBp: Object.fromEntries(ids.map((id) => [id, spec.customBp?.[id] ?? 0])) } : {}),
    });
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : 'Invalid split', 'invalid_split');
  }
}

function writeShares(db: Db, expenseId: string, shares: Record<string, Cents>): void {
  db.prepare('DELETE FROM expense_shares WHERE expense_id = ?').run(expenseId);
  const insert = db.prepare('INSERT INTO expense_shares (expense_id, person_id, amount_cents) VALUES (?, ?, ?)');
  for (const [personId, amount] of Object.entries(shares)) insert.run(expenseId, personId, amount);
}

function writeTags(db: Db, expenseId: string, tags: string[]): void {
  db.prepare('DELETE FROM expense_tags WHERE expense_id = ?').run(expenseId);
  const find = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
  const insertTag = db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)');
  const link = db.prepare('INSERT OR IGNORE INTO expense_tags (expense_id, tag_id) VALUES (?, ?)');
  for (const raw of tags) {
    const name = raw.trim().replace(/^#/, '');
    if (!name) continue;
    const existing = find.get(name) as { id: string } | undefined;
    const id = existing?.id ?? newId();
    if (!existing) insertTag.run(id, name);
    link.run(expenseId, id);
  }
}

function validateRefs(db: Db, input: ExpenseInput, existing?: ExpenseRow): void {
  const ids = personIds(db);
  if (!ids.includes(input.payerId)) throw badRequest('Unknown payer', 'unknown_person');
  if (input.singleId && !ids.includes(input.singleId)) throw badRequest('Unknown person', 'unknown_person');

  const category = db.prepare('SELECT id, archived FROM categories WHERE id = ?').get(input.categoryId) as
    | { id: string; archived: number }
    | undefined;
  if (!category) throw badRequest('Unknown category', 'category_not_found');
  const keepsArchivedCategory = existing?.category_id === input.categoryId;
  if (category.archived === 1 && !keepsArchivedCategory) {
    throw badRequest('This category is archived', 'category_archived');
  }
  if (input.subcategoryId) {
    const sub = db.prepare('SELECT category_id FROM subcategories WHERE id = ?').get(input.subcategoryId) as
      | { category_id: string }
      | undefined;
    if (!sub || sub.category_id !== input.categoryId) {
      throw badRequest('Sub-line does not belong to the category', 'subcategory_mismatch');
    }
  }
}

export function createExpense(
  db: Db,
  input: ExpenseInput,
  opts: { createdBy: string | null; status?: 'confirmed' | 'pending'; auto?: boolean } ,
): ExpenseDto {
  validateRefs(db, input);
  const month = monthOfDate(input.date);
  const id = newId();
  db.transaction(() => {
    ensureMonth(db, month);
    const shares = sharesFor(db, month, input);
    const now = nowIso();
    db.prepare(
      `INSERT INTO expenses (id, date, month, amount_cents, category_id, subcategory_id, payer_id, split_mode,
         single_id, custom_bp, note, status, auto, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.date,
      month,
      input.amountCents,
      input.categoryId,
      input.subcategoryId,
      input.payerId,
      input.splitMode,
      input.splitMode === 'single' ? input.singleId : null,
      input.splitMode === 'custom' ? JSON.stringify(input.customBp) : null,
      input.note.trim(),
      opts.status ?? 'confirmed',
      opts.auto ? 1 : 0,
      opts.createdBy,
      now,
      now,
    );
    writeShares(db, id, shares);
    writeTags(db, id, input.tags);
  })();
  return getExpense(db, id);
}

/** Updating an expense confirms it: editing an "à confirmer" expense is how its real amount is entered. */
export function updateExpense(db: Db, id: string, input: ExpenseInput): ExpenseDto {
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as ExpenseRow | undefined;
  if (!row) throw notFound(`Expense not found: ${id}`, 'expense_not_found');
  validateRefs(db, input, row);
  const month = monthOfDate(input.date);
  db.transaction(() => {
    ensureMonth(db, month);
    const shares = sharesFor(db, month, input);
    db.prepare(
      `UPDATE expenses SET date = ?, month = ?, amount_cents = ?, category_id = ?, subcategory_id = ?, payer_id = ?,
         split_mode = ?, single_id = ?, custom_bp = ?, note = ?, status = 'confirmed', updated_at = ? WHERE id = ?`,
    ).run(
      input.date,
      month,
      input.amountCents,
      input.categoryId,
      input.subcategoryId,
      input.payerId,
      input.splitMode,
      input.splitMode === 'single' ? input.singleId : null,
      input.splitMode === 'custom' ? JSON.stringify(input.customBp) : null,
      input.note.trim(),
      nowIso(),
      id,
    );
    writeShares(db, id, shares);
    writeTags(db, id, input.tags);
  })();
  return getExpense(db, id);
}

export function deleteExpense(db: Db, id: string): void {
  const result = db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  if (result.changes === 0) throw notFound(`Expense not found: ${id}`, 'expense_not_found');
}

export function confirmExpense(db: Db, id: string, amountCents?: Cents): ExpenseDto {
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as ExpenseRow | undefined;
  if (!row) throw notFound(`Expense not found: ${id}`, 'expense_not_found');
  db.transaction(() => {
    const amount = amountCents ?? row.amount_cents;
    db.prepare("UPDATE expenses SET status = 'confirmed', amount_cents = ?, updated_at = ? WHERE id = ?").run(
      amount,
      nowIso(),
      id,
    );
    if (amount !== row.amount_cents) {
      writeShares(
        db,
        id,
        sharesFor(db, row.month, {
          amountCents: amount,
          payerId: row.payer_id,
          splitMode: row.split_mode,
          singleId: row.single_id,
          customBp: row.custom_bp ? (JSON.parse(row.custom_bp) as Record<string, number>) : null,
        }),
      );
    }
  })();
  return getExpense(db, id);
}

/**
 * Re-freezes the month's income ratio from its current incomes and recomputes the shares of every
 * expense of that month split proportionally to income. Other split modes are untouched.
 */
export function recalculateMonth(db: Db, month: MonthKey): { updated: number } {
  let updated = 0;
  db.transaction(() => {
    refreezeWeights(db, month);
    const rows = db
      .prepare("SELECT * FROM expenses WHERE month = ? AND split_mode = 'income'")
      .all(month) as ExpenseRow[];
    for (const row of rows) {
      writeShares(
        db,
        row.id,
        sharesFor(db, month, {
          amountCents: row.amount_cents,
          payerId: row.payer_id,
          splitMode: 'income',
          singleId: null,
          customBp: null,
        }),
      );
      updated += 1;
    }
  })();
  return { updated };
}

export function listTags(db: Db): { name: string; count: number }[] {
  return db
    .prepare(
      `SELECT t.name AS name, COUNT(et.expense_id) AS count FROM tags t
       JOIN expense_tags et ON et.tag_id = t.id GROUP BY t.id ORDER BY count DESC, t.name`,
    )
    .all() as { name: string; count: number }[];
}
