import {
  carryAfter,
  carryModeFor,
  computeEnvelope,
  projectEndOfMonth,
  type BudgetStatus,
  type Cents,
  type DashboardCategory,
  type DashboardDto,
  type DashboardGroup,
  type MonthKey,
  MAX_RATIO,
  statusFor,
} from '@budget/shared';
import { thisMonth, today, type AppContext } from '../context.js';
import { getCatalog } from './catalog.js';
import { getIncomes, listMonthKeys, requireMonth } from './months.js';

interface LineRow {
  month: string;
  category_id: string;
  subcategory_id: string | null;
  planned_cents: number;
}

interface SpentRow {
  month: string;
  category_id: string;
  subcategory_id: string | null;
  spent: number;
  n: number;
  pending: number;
}

interface TransferRow {
  month: string;
  from_category_id: string;
  to_category_id: string;
  amount_cents: number;
}

function ratioOf(spent: Cents, effective: Cents): number {
  return effective > 0 ? Math.min(MAX_RATIO, spent / effective) : spent > 0 ? MAX_RATIO : 0;
}

export function buildDashboard(ctx: AppContext, month: MonthKey): DashboardDto {
  const { db } = ctx;
  requireMonth(db, month);

  const current = thisMonth(ctx);
  const position = month < current ? 'past' : month === current ? 'current' : 'future';
  const todayDay = position === 'current' ? Number(today(ctx).slice(8, 10)) : null;
  const months = listMonthKeys(db).filter((m) => m < month);

  const lines = db
    .prepare('SELECT month, category_id, subcategory_id, planned_cents FROM budget_lines WHERE month <= ?')
    .all(month) as LineRow[];
  const spentRows = db
    .prepare(
      `SELECT month, category_id, subcategory_id, SUM(amount_cents) AS spent, COUNT(*) AS n,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM expenses WHERE month <= ? GROUP BY month, category_id, subcategory_id`,
    )
    .all(month) as SpentRow[];
  const transfers = db
    .prepare('SELECT month, from_category_id, to_category_id, amount_cents FROM envelope_transfers WHERE month <= ?')
    .all(month) as TransferRow[];

  // Per (month, category) aggregates.
  const key = (m: string, c: string): string => `${m}|${c}`;
  const planned = new Map<string, Cents>();
  for (const l of lines) planned.set(key(l.month, l.category_id), (planned.get(key(l.month, l.category_id)) ?? 0) + l.planned_cents);
  const spent = new Map<string, { total: Cents; n: number; pending: number }>();
  for (const s of spentRows) {
    const k = key(s.month, s.category_id);
    const e = spent.get(k) ?? { total: 0, n: 0, pending: 0 };
    e.total += s.spent;
    e.n += s.n;
    e.pending += s.pending;
    spent.set(k, e);
  }
  const tin = new Map<string, Cents>();
  const tout = new Map<string, Cents>();
  for (const t of transfers) {
    tout.set(key(t.month, t.from_category_id), (tout.get(key(t.month, t.from_category_id)) ?? 0) + t.amount_cents);
    tin.set(key(t.month, t.to_category_id), (tin.get(key(t.month, t.to_category_id)) ?? 0) + t.amount_cents);
  }

  const subSpent = new Map<string, Cents>();
  for (const s of spentRows) {
    if (s.month === month && s.subcategory_id) subSpent.set(s.subcategory_id, s.spent);
  }
  const subPlanned = new Map<string, Cents>();
  for (const l of lines) {
    if (l.month === month && l.subcategory_id) subPlanned.set(l.subcategory_id, l.planned_cents);
  }

  const catalog = getCatalog(db);
  const groups: DashboardGroup[] = [];

  for (const group of catalog) {
    const categories: DashboardCategory[] = [];
    for (const cat of group.categories) {
      const k = key(month, cat.id);
      const monthPlanned = planned.get(k) ?? 0;
      const monthSpent = spent.get(k) ?? { total: 0, n: 0, pending: 0 };
      const monthIn = tin.get(k) ?? 0;
      const monthOut = tout.get(k) ?? 0;
      const hasLine = planned.has(k);
      if (!hasLine && monthSpent.total === 0 && monthIn === 0 && monthOut === 0) continue;

      const mode = carryModeFor(cat.kind, cat.rollover);
      const history = months.map((m) => ({
        base: (planned.get(key(m, cat.id)) ?? 0) + (tin.get(key(m, cat.id)) ?? 0) - (tout.get(key(m, cat.id)) ?? 0),
        spent: spent.get(key(m, cat.id))?.total ?? 0,
      }));
      const carryIn = carryAfter(history, mode);
      const env = computeEnvelope({
        kind: cat.kind,
        planned: monthPlanned,
        transfersIn: monthIn,
        transfersOut: monthOut,
        spent: monthSpent.total,
        carryIn,
      });
      categories.push({
        categoryId: cat.id,
        groupId: group.id,
        name: cat.name,
        kind: cat.kind,
        isSystem: cat.isSystem,
        planned: monthPlanned,
        transfersIn: monthIn,
        transfersOut: monthOut,
        carryIn,
        effective: env.effective,
        spent: monthSpent.total,
        remaining: env.remaining,
        ratio: env.ratio,
        status: env.status,
        projected: projectEndOfMonth({
          kind: cat.kind,
          month,
          todayDay,
          position,
          spent: monthSpent.total,
          effective: env.effective,
        }),
        expenseCount: monthSpent.n,
        pendingCount: monthSpent.pending,
        subLines: cat.subcategories
          .filter((s) => subPlanned.has(s.id) || subSpent.has(s.id))
          .map((s) => ({
            subcategoryId: s.id,
            name: s.name,
            planned: subPlanned.get(s.id) ?? 0,
            spent: subSpent.get(s.id) ?? 0,
          })),
      });
    }
    if (categories.length === 0) continue;
    const sum = (f: (c: DashboardCategory) => Cents): Cents => categories.reduce((s, c) => s + f(c), 0);
    const gEffective = sum((c) => c.effective);
    const gSpent = sum((c) => c.spent);
    const gRatio = ratioOf(gSpent, gEffective);
    const status: BudgetStatus = statusFor(gRatio, gSpent);
    groups.push({
      groupId: group.id,
      name: group.name,
      planned: sum((c) => c.planned),
      effective: gEffective,
      spent: gSpent,
      remaining: gEffective - gSpent,
      ratio: gRatio,
      status,
      categories,
    });
  }

  const all = groups.flatMap((g) => g.categories);
  const total = (f: (c: DashboardCategory) => Cents): Cents => all.reduce((s, c) => s + f(c), 0);
  const income = getIncomes(db, month).reduce((s, i) => s + i.amountCents, 0);
  const totalSpent = total((c) => c.spent);
  const contributions = (
    db.prepare('SELECT COALESCE(SUM(contribution_cents), 0) AS s FROM savings_entries WHERE month = ?').get(month) as {
      s: number;
    }
  ).s;
  const imprevus = all.find((c) => c.isSystem);
  const pendingCount = all.reduce((s, c) => s + c.pendingCount, 0);

  return {
    month,
    position,
    groups,
    totals: {
      planned: total((c) => c.planned),
      effective: total((c) => c.effective),
      spent: totalSpent,
      remaining: total((c) => c.effective) - totalSpent,
      projected: total((c) => c.projected),
      income,
      plannedBalance: income - total((c) => c.planned),
      actualBalance: income - totalSpent,
      savingsContributions: contributions,
      savingsRate: income > 0 ? contributions / income : null,
    },
    imprevusCount: imprevus?.expenseCount ?? 0,
    imprevusCents: imprevus?.spent ?? 0,
    pendingCount,
  };
}
