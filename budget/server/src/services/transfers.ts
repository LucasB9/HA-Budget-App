import type { MonthKey, TransferDto } from '@budget/shared';
import { newId, nowIso, type Db } from '../db/connection.js';
import { notFound } from '../errors.js';
import { getCategoryRow } from './catalog.js';
import { requireMonth } from './months.js';

interface TransferRow {
  id: string;
  month: string;
  from_category_id: string;
  to_category_id: string;
  amount_cents: number;
  note: string;
  created_at: string;
}

function toDto(r: TransferRow): TransferDto {
  return {
    id: r.id,
    month: r.month,
    fromCategoryId: r.from_category_id,
    toCategoryId: r.to_category_id,
    amountCents: r.amount_cents,
    note: r.note,
    createdAt: r.created_at,
  };
}

export function listTransfers(db: Db, month: MonthKey): TransferDto[] {
  requireMonth(db, month);
  return (
    db.prepare('SELECT * FROM envelope_transfers WHERE month = ? ORDER BY created_at DESC').all(month) as TransferRow[]
  ).map(toDto);
}

export function createTransfer(
  db: Db,
  month: MonthKey,
  input: { fromCategoryId: string; toCategoryId: string; amountCents: number; note: string },
): TransferDto {
  requireMonth(db, month);
  getCategoryRow(db, input.fromCategoryId);
  getCategoryRow(db, input.toCategoryId);
  const id = newId();
  db.prepare(
    `INSERT INTO envelope_transfers (id, month, from_category_id, to_category_id, amount_cents, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, month, input.fromCategoryId, input.toCategoryId, input.amountCents, input.note.trim(), nowIso());
  return toDto(db.prepare('SELECT * FROM envelope_transfers WHERE id = ?').get(id) as TransferRow);
}

export function deleteTransfer(db: Db, month: MonthKey, id: string): void {
  const result = db.prepare('DELETE FROM envelope_transfers WHERE id = ? AND month = ?').run(id, month);
  if (result.changes === 0) throw notFound(`Transfer not found: ${id}`, 'transfer_not_found');
}
