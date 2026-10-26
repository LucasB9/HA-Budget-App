import {
  monthRange,
  type Cents,
  type MonthKey,
  type SavingsAccountDto,
  type SavingsEntryDto,
  type SavingsGoalDto,
  type SavingsMonthStat,
  type SavingsOverviewDto,
  type SavingsSeriesPoint,
} from '@budget/shared';
import { thisMonth, type AppContext } from '../context.js';
import { newId, type Db } from '../db/connection.js';
import { badRequest, notFound } from '../errors.js';
import { getSettings } from './people.js';

interface AccountRow {
  id: string;
  name: string;
  kind: string;
  goal_cents: number | null;
  goal_date: string | null;
  archived: number;
  position: number;
}

interface EntryRow {
  account_id: string;
  month: string;
  contribution_cents: number;
  balance_cents: number | null;
  note: string;
}

export function createAccount(
  db: Db,
  input: { name: string; kind: string; goalCents: Cents | null; goalDate: string | null },
): string {
  const id = newId();
  const position = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM savings_accounts').get() as { p: number }).p;
  db.prepare(
    'INSERT INTO savings_accounts (id, name, kind, goal_cents, goal_date, position) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, input.name.trim(), input.kind.trim(), input.goalCents, input.goalDate, position);
  return id;
}

export function updateAccount(
  db: Db,
  id: string,
  patch: {
    name?: string | undefined;
    kind?: string | undefined;
    goalCents?: Cents | null | undefined;
    goalDate?: string | null | undefined;
    archived?: boolean | undefined;
  },
): void {
  const row = db.prepare('SELECT * FROM savings_accounts WHERE id = ?').get(id) as AccountRow | undefined;
  if (!row) throw notFound(`Savings account not found: ${id}`, 'account_not_found');
  db.prepare(
    'UPDATE savings_accounts SET name = ?, kind = ?, goal_cents = ?, goal_date = ?, archived = ? WHERE id = ?',
  ).run(
    patch.name?.trim() ?? row.name,
    patch.kind?.trim() ?? row.kind,
    patch.goalCents === undefined ? row.goal_cents : patch.goalCents,
    patch.goalDate === undefined ? row.goal_date : patch.goalDate,
    patch.archived === undefined ? row.archived : patch.archived ? 1 : 0,
    id,
  );
}

/**
 * Sets the contribution and optional end-of-month balance of an account for a month.
 * An entry with nothing in it is removed.
 */
export function upsertEntry(
  db: Db,
  input: { accountId: string; month: MonthKey; contributionCents: number; balanceCents: Cents | null; note: string },
): void {
  const account = db.prepare('SELECT archived FROM savings_accounts WHERE id = ?').get(input.accountId) as
    | { archived: number }
    | undefined;
  if (!account) throw notFound(`Savings account not found: ${input.accountId}`, 'account_not_found');
  if (account.archived === 1) throw badRequest('This account is archived', 'account_archived');

  const empty = input.contributionCents === 0 && input.balanceCents === null && input.note.trim() === '';
  if (empty) {
    db.prepare('DELETE FROM savings_entries WHERE account_id = ? AND month = ?').run(input.accountId, input.month);
    return;
  }
  db.prepare(
    `INSERT INTO savings_entries (account_id, month, contribution_cents, balance_cents, note) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, month) DO UPDATE SET contribution_cents = excluded.contribution_cents,
       balance_cents = excluded.balance_cents, note = excluded.note`,
  ).run(input.accountId, input.month, input.contributionCents, input.balanceCents, input.note.trim());
}

export function buildSavingsOverview(ctx: AppContext): SavingsOverviewDto {
  const { db } = ctx;
  const accountRows = db.prepare('SELECT * FROM savings_accounts ORDER BY position, name').all() as AccountRow[];
  const entryRows = db.prepare('SELECT * FROM savings_entries ORDER BY month').all() as EntryRow[];

  const entries: SavingsEntryDto[] = entryRows.map((e) => ({
    accountId: e.account_id,
    month: e.month,
    contributionCents: e.contribution_cents,
    balanceCents: e.balance_cents,
    note: e.note,
  }));

  const current = thisMonth(ctx);
  const first = entryRows[0]?.month ?? current;
  const last = [current, ...entryRows.map((e) => e.month)].sort().at(-1) as MonthKey;
  const months = monthRange(first < current ? first : current, last);

  // Series: cumulative contributions per account and last known balances, month by month.
  const byAccountMonth = new Map<string, EntryRow>(entryRows.map((e) => [`${e.account_id}|${e.month}`, e]));
  const cumulative = new Map<string, Cents>(accountRows.map((a) => [a.id, 0]));
  const lastBalance = new Map<string, Cents>();
  const series: SavingsSeriesPoint[] = months.map((month) => {
    let contributionCents = 0;
    for (const a of accountRows) {
      const e = byAccountMonth.get(`${a.id}|${month}`);
      if (!e) continue;
      contributionCents += e.contribution_cents;
      cumulative.set(a.id, (cumulative.get(a.id) ?? 0) + e.contribution_cents);
      if (e.balance_cents !== null) lastBalance.set(a.id, e.balance_cents);
    }
    // Total value: last known balance per account, or what was put in when no snapshot exists yet.
    const value = accountRows.reduce((sum, a) => sum + (lastBalance.get(a.id) ?? cumulative.get(a.id) ?? 0), 0);
    return {
      month,
      contributionCents,
      cumulativeCents: [...cumulative.values()].reduce((s, v) => s + v, 0),
      perAccount: Object.fromEntries(cumulative),
      balanceCents: lastBalance.size > 0 ? value : null,
    };
  });

  // Per-account summary (all-time).
  const accounts: SavingsAccountDto[] = accountRows.map((a) => {
    const mine = entryRows.filter((e) => e.account_id === a.id);
    const contributionsCents = mine.reduce((s, e) => s + e.contribution_cents, 0);
    const withBalance = mine.filter((e) => e.balance_cents !== null).at(-1);
    const currentCents = withBalance?.balance_cents ?? contributionsCents;
    return {
      id: a.id,
      name: a.name,
      kind: a.kind,
      goalCents: a.goal_cents,
      goalDate: a.goal_date,
      archived: a.archived === 1,
      position: a.position,
      contributionsCents,
      latestBalanceCents: withBalance?.balance_cents ?? null,
      latestBalanceMonth: withBalance?.month ?? null,
      currentCents,
      progress: a.goal_cents && a.goal_cents > 0 ? currentCents / a.goal_cents : null,
    };
  });

  // Planned vs actual savings, per month.
  const incomeByMonth = new Map(
    (
      db.prepare('SELECT month, SUM(amount_cents) AS s FROM month_incomes GROUP BY month').all() as {
        month: string;
        s: number;
      }[]
    ).map((r) => [r.month, r.s]),
  );
  const plannedByMonth = new Map(
    (
      db.prepare('SELECT month, SUM(planned_cents) AS s FROM budget_lines GROUP BY month').all() as {
        month: string;
        s: number;
      }[]
    ).map((r) => [r.month, r.s]),
  );
  const monthStats: SavingsMonthStat[] = series.map((point) => {
    const income = incomeByMonth.get(point.month) ?? 0;
    const planned = plannedByMonth.get(point.month);
    return {
      month: point.month,
      incomeCents: income,
      plannedCents: planned === undefined ? null : income - planned,
      contributionCents: point.contributionCents,
      rate: income > 0 ? point.contributionCents / income : null,
    };
  });

  const settings = getSettings(db);
  let goal: SavingsGoalDto | null = null;
  if (settings.savingsGoalCents && settings.savingsGoalCents > 0) {
    const currentCents = accounts.filter((a) => !a.archived).reduce((s, a) => s + a.currentCents, 0);
    goal = {
      targetCents: settings.savingsGoalCents,
      date: settings.savingsGoalDate,
      currentCents,
      progress: currentCents / settings.savingsGoalCents,
    };
  }

  return { accounts, entries, series, monthStats, goal };
}
