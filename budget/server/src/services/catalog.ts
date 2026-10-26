import type { CategoryDto, DefaultSplit, GroupDto, SubcategoryDto } from '@budget/shared';
import type { CategoryKind } from '@budget/shared';
import { newId, type Db } from '../db/connection.js';
import { badRequest, conflict, notFound } from '../errors.js';

interface GroupRow {
  id: string;
  name: string;
  position: number;
  archived: number;
}

interface CategoryRow {
  id: string;
  group_id: string;
  name: string;
  kind: CategoryKind;
  planned_cents: number;
  rollover: number;
  fixed_day: number;
  default_payer_id: string | null;
  default_split: DefaultSplit;
  archived: number;
  is_system: number;
  position: number;
}

interface SubcategoryRow {
  id: string;
  category_id: string;
  name: string;
  planned_cents: number;
  archived: number;
  position: number;
}

export const SYSTEM_GROUP_NAME = 'Divers';
export const SYSTEM_CATEGORY_NAME = 'Imprévus';

function toSub(r: SubcategoryRow): SubcategoryDto {
  return {
    id: r.id,
    categoryId: r.category_id,
    name: r.name,
    plannedCents: r.planned_cents,
    archived: r.archived === 1,
    position: r.position,
  };
}

export function getCatalog(db: Db): GroupDto[] {
  const groups = db.prepare('SELECT * FROM groups ORDER BY position, name').all() as GroupRow[];
  const categories = db.prepare('SELECT * FROM categories ORDER BY position, name').all() as CategoryRow[];
  const subs = db.prepare('SELECT * FROM subcategories ORDER BY position, name').all() as SubcategoryRow[];
  const subsByCategory = new Map<string, SubcategoryDto[]>();
  for (const s of subs) {
    const list = subsByCategory.get(s.category_id) ?? [];
    list.push(toSub(s));
    subsByCategory.set(s.category_id, list);
  }
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    archived: g.archived === 1,
    position: g.position,
    categories: categories
      .filter((c) => c.group_id === g.id)
      .map((c) => {
        const subcategories = subsByCategory.get(c.id) ?? [];
        const active = subcategories.filter((s) => !s.archived);
        return {
          id: c.id,
          groupId: c.group_id,
          name: c.name,
          kind: c.kind,
          plannedCents: active.length > 0 ? active.reduce((sum, s) => sum + s.plannedCents, 0) : c.planned_cents,
          rollover: c.rollover === 1,
          fixedDay: c.fixed_day,
          defaultPayerId: c.default_payer_id,
          defaultSplit: c.default_split,
          archived: c.archived === 1,
          isSystem: c.is_system === 1,
          position: c.position,
          subcategories,
        };
      }),
  }));
}

export function getCategoryRow(db: Db, id: string): CategoryRow {
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
  if (!row) throw notFound(`Category not found: ${id}`, 'category_not_found');
  return row;
}

export function getSubcategoryRow(db: Db, id: string): SubcategoryRow {
  const row = db.prepare('SELECT * FROM subcategories WHERE id = ?').get(id) as SubcategoryRow | undefined;
  if (!row) throw notFound(`Sub-line not found: ${id}`, 'subcategory_not_found');
  return row;
}

function nextPosition(db: Db, table: 'groups' | 'categories' | 'subcategories', where = '', arg?: string): number {
  const sql = `SELECT COALESCE(MAX(position), -1) + 1 AS p FROM ${table} ${where}`;
  const row = (arg === undefined ? db.prepare(sql).get() : db.prepare(sql).get(arg)) as { p: number };
  return row.p;
}

export function createGroup(db: Db, name: string): string {
  const id = newId();
  db.prepare('INSERT INTO groups (id, name, position) VALUES (?, ?, ?)').run(id, name.trim(), nextPosition(db, 'groups'));
  return id;
}

export function updateGroup(db: Db, id: string, patch: { name?: string | undefined; archived?: boolean | undefined }): void {
  const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as GroupRow | undefined;
  if (!row) throw notFound(`Group not found: ${id}`, 'group_not_found');
  db.prepare('UPDATE groups SET name = ?, archived = ? WHERE id = ?').run(
    patch.name?.trim() ?? row.name,
    patch.archived === undefined ? row.archived : patch.archived ? 1 : 0,
    id,
  );
}

export interface CategoryCreate {
  groupId: string;
  name: string;
  kind: 'fixed' | 'variable' | 'provision';
  plannedCents: number;
  rollover: boolean;
  fixedDay: number;
  defaultPayerId?: string | null | undefined;
  defaultSplit: DefaultSplit;
}

export function createCategory(db: Db, input: CategoryCreate): string {
  if (!db.prepare('SELECT 1 FROM groups WHERE id = ?').get(input.groupId)) {
    throw notFound(`Group not found: ${input.groupId}`, 'group_not_found');
  }
  const id = newId();
  db.prepare(
    `INSERT INTO categories (id, group_id, name, kind, planned_cents, rollover, fixed_day, default_payer_id, default_split, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.groupId,
    input.name.trim(),
    input.kind,
    input.plannedCents,
    input.rollover ? 1 : 0,
    input.fixedDay,
    input.defaultPayerId ?? null,
    input.defaultSplit,
    nextPosition(db, 'categories', 'WHERE group_id = ?', input.groupId),
  );
  return id;
}

export interface CategoryPatch {
  groupId?: string | undefined;
  name?: string | undefined;
  kind?: 'fixed' | 'variable' | 'provision' | undefined;
  plannedCents?: number | undefined;
  rollover?: boolean | undefined;
  fixedDay?: number | undefined;
  defaultPayerId?: string | null | undefined;
  defaultSplit?: DefaultSplit | undefined;
  archived?: boolean | undefined;
}

export function updateCategory(db: Db, id: string, patch: CategoryPatch): void {
  const row = getCategoryRow(db, id);
  if (row.is_system === 1 && (patch.archived || patch.kind || patch.name || patch.groupId)) {
    throw badRequest('The built-in category cannot be renamed, moved or archived', 'system_category');
  }
  if (patch.groupId && !db.prepare('SELECT 1 FROM groups WHERE id = ?').get(patch.groupId)) {
    throw notFound(`Group not found: ${patch.groupId}`, 'group_not_found');
  }
  db.prepare(
    `UPDATE categories SET group_id = ?, name = ?, kind = ?, planned_cents = ?, rollover = ?, fixed_day = ?,
       default_payer_id = ?, default_split = ?, archived = ? WHERE id = ?`,
  ).run(
    patch.groupId ?? row.group_id,
    patch.name?.trim() ?? row.name,
    patch.kind ?? row.kind,
    patch.plannedCents ?? row.planned_cents,
    patch.rollover === undefined ? row.rollover : patch.rollover ? 1 : 0,
    patch.fixedDay ?? row.fixed_day,
    patch.defaultPayerId === undefined ? row.default_payer_id : patch.defaultPayerId,
    patch.defaultSplit ?? row.default_split,
    patch.archived === undefined ? row.archived : patch.archived ? 1 : 0,
    id,
  );
}

export function createSubcategory(db: Db, input: { categoryId: string; name: string; plannedCents: number }): string {
  getCategoryRow(db, input.categoryId);
  const id = newId();
  db.prepare(
    'INSERT INTO subcategories (id, category_id, name, planned_cents, position) VALUES (?, ?, ?, ?, ?)',
  ).run(id, input.categoryId, input.name.trim(), input.plannedCents, nextPosition(db, 'subcategories', 'WHERE category_id = ?', input.categoryId));
  return id;
}

export function updateSubcategory(
  db: Db,
  id: string,
  patch: { name?: string | undefined; plannedCents?: number | undefined; archived?: boolean | undefined },
): void {
  const row = getSubcategoryRow(db, id);
  db.prepare('UPDATE subcategories SET name = ?, planned_cents = ?, archived = ? WHERE id = ?').run(
    patch.name?.trim() ?? row.name,
    patch.plannedCents ?? row.planned_cents,
    patch.archived === undefined ? row.archived : patch.archived ? 1 : 0,
    id,
  );
}

export function reorder(db: Db, kind: 'group' | 'category', ids: string[]): void {
  const table = kind === 'group' ? 'groups' : 'categories';
  const update = db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`);
  db.transaction(() => {
    ids.forEach((id, index) => {
      if (update.run(index, id).changes === 0) throw notFound(`Unknown ${kind}: ${id}`);
    });
  })();
}

/**
 * Moves every expense, transfer and budget amount of `fromId` into `intoId`, then archives `fromId`.
 * Sub-line detail is dropped: affected expenses land on the destination category itself.
 */
export function mergeCategories(db: Db, fromId: string, intoId: string): void {
  if (fromId === intoId) throw badRequest('Cannot merge a category into itself');
  const from = getCategoryRow(db, fromId);
  const into = getCategoryRow(db, intoId);
  if (from.is_system === 1) throw badRequest('The built-in category cannot be merged away', 'system_category');
  if (into.archived === 1) throw conflict('Destination category is archived');

  db.transaction(() => {
    db.prepare('UPDATE expenses SET category_id = ?, subcategory_id = NULL WHERE category_id = ?').run(intoId, fromId);
    db.prepare('UPDATE envelope_transfers SET from_category_id = ? WHERE from_category_id = ?').run(intoId, fromId);
    db.prepare('UPDATE envelope_transfers SET to_category_id = ? WHERE to_category_id = ?').run(intoId, fromId);
    // A transfer between the two categories would now point at itself: drop those.
    db.prepare('DELETE FROM envelope_transfers WHERE from_category_id = to_category_id').run();

    const months = db
      .prepare('SELECT DISTINCT month FROM budget_lines WHERE category_id = ?')
      .all(fromId) as { month: string }[];
    for (const { month } of months) {
      const sum = (
        db
          .prepare('SELECT COALESCE(SUM(planned_cents), 0) AS s FROM budget_lines WHERE month = ? AND category_id = ?')
          .get(month, fromId) as { s: number }
      ).s;
      db.prepare('DELETE FROM budget_lines WHERE month = ? AND category_id = ?').run(month, fromId);
      // Fold the amount into the destination's line (leaf lines may be sub-lines: use the first).
      const target = db
        .prepare(
          'SELECT id FROM budget_lines WHERE month = ? AND category_id = ? ORDER BY subcategory_id IS NOT NULL, rowid LIMIT 1',
        )
        .get(month, intoId) as { id: string } | undefined;
      if (target) {
        db.prepare('UPDATE budget_lines SET planned_cents = planned_cents + ? WHERE id = ?').run(sum, target.id);
      } else {
        db.prepare(
          'INSERT INTO budget_lines (id, month, category_id, subcategory_id, planned_cents) VALUES (?, ?, ?, NULL, ?)',
        ).run(newId(), month, intoId, sum);
      }
    }
    db.prepare('UPDATE categories SET archived = 1 WHERE id = ?').run(fromId);
  })();
}

/** Ensures the built-in "Imprévus" category exists. Returns its id. */
export function ensureSystemCategory(db: Db): string {
  const existing = db.prepare('SELECT id FROM categories WHERE is_system = 1').get() as { id: string } | undefined;
  if (existing) return existing.id;
  let group = db.prepare('SELECT id FROM groups WHERE name = ?').get(SYSTEM_GROUP_NAME) as { id: string } | undefined;
  if (!group) group = { id: createGroup(db, SYSTEM_GROUP_NAME) };
  const id = newId();
  db.prepare(
    `INSERT INTO categories (id, group_id, name, kind, planned_cents, is_system, position)
     VALUES (?, ?, ?, 'system', 0, 1, ?)`,
  ).run(id, group.id, SYSTEM_CATEGORY_NAME, nextPosition(db, 'categories', 'WHERE group_id = ?', group.id));
  return id;
}
