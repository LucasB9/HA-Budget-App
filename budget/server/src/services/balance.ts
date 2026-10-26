import {
  computeNet,
  debtFromNet,
  ratioFromWeights,
  type BalanceDto,
  type BalanceExpense,
  type BalanceSummary,
  type Cents,
  type MonthKey,
  type SettlementDto,
} from '@budget/shared';
import { newId, nowIso, type Db } from '../db/connection.js';
import { notFound } from '../errors.js';
import { listExpenses } from './expenses.js';
import { getWeights, monthExists } from './months.js';
import { personIds, requirePerson } from './people.js';

interface SettlementRow {
  id: string;
  date: string;
  from_id: string;
  to_id: string;
  amount_cents: number;
  note: string;
  created_at: string;
}

function toDto(r: SettlementRow): SettlementDto {
  return {
    id: r.id,
    date: r.date,
    fromId: r.from_id,
    toId: r.to_id,
    amountCents: r.amount_cents,
    note: r.note,
    createdAt: r.created_at,
  };
}

export function listSettlements(db: Db, month?: MonthKey): SettlementDto[] {
  const rows = month
    ? (db
        .prepare("SELECT * FROM settlements WHERE substr(date, 1, 7) = ? ORDER BY date DESC, created_at DESC")
        .all(month) as SettlementRow[])
    : (db.prepare('SELECT * FROM settlements ORDER BY date DESC, created_at DESC').all() as SettlementRow[]);
  return rows.map(toDto);
}

export function createSettlement(
  db: Db,
  input: { date: string; fromId: string; toId: string; amountCents: Cents; note: string },
): SettlementDto {
  requirePerson(db, input.fromId);
  requirePerson(db, input.toId);
  const id = newId();
  db.prepare(
    'INSERT INTO settlements (id, date, from_id, to_id, amount_cents, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, input.date, input.fromId, input.toId, input.amountCents, input.note.trim(), nowIso());
  return toDto(db.prepare('SELECT * FROM settlements WHERE id = ?').get(id) as SettlementRow);
}

export function deleteSettlement(db: Db, id: string): void {
  const result = db.prepare('DELETE FROM settlements WHERE id = ?').run(id);
  if (result.changes === 0) throw notFound(`Settlement not found: ${id}`, 'settlement_not_found');
}

function summarize(
  ids: string[],
  expenses: BalanceExpense[],
  settlements: SettlementDto[],
): BalanceSummary {
  const net = computeNet(
    ids,
    expenses,
    settlements.map((s) => ({ fromId: s.fromId, toId: s.toId, amountCents: s.amountCents })),
  );
  return { net, debt: debtFromNet(net) };
}

export function buildBalance(db: Db, month: MonthKey): BalanceDto {
  const ids = personIds(db);
  // Pending ("à confirmer") expenses have a guessed payer and amount: they never move a balance.
  const monthAll = listExpenses(db, { month }, 100_000);
  const monthExpenses = monthAll.filter((e) => e.status === 'confirmed');
  const pending = monthAll.filter((e) => e.status === 'pending');
  const allExpenses = listExpenses(db, { status: 'confirmed' }, 1_000_000);
  const monthSettlements = listSettlements(db, month);
  const allSettlements = listSettlements(db);

  const monthPaid: Record<string, Cents> = Object.fromEntries(ids.map((id) => [id, 0]));
  const monthShare: Record<string, Cents> = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const e of monthExpenses) {
    monthPaid[e.payerId] = (monthPaid[e.payerId] ?? 0) + e.amountCents;
    for (const id of ids) monthShare[id] = (monthShare[id] ?? 0) + (e.shares[id] ?? 0);
  }

  const weights = monthExists(db, month) ? getWeights(db, month) : Object.fromEntries(ids.map((id) => [id, 1]));
  return {
    month,
    ratio: ratioFromWeights(weights, ids),
    pendingCount: pending.length,
    pendingCents: pending.reduce((sum, e) => sum + e.amountCents, 0),
    monthBalance: summarize(ids, monthExpenses, monthSettlements),
    overallBalance: summarize(ids, allExpenses, allSettlements),
    monthPaid,
    monthShare,
    settlements: allSettlements,
  };
}
