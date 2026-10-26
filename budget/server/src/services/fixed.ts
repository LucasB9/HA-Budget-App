import { dateInMonth, type MonthKey } from '@budget/shared';
import { thisMonth, today, type AppContext } from '../context.js';
import { ensureSystemCategory } from './catalog.js';
import { createExpense } from './expenses.js';
import { ensureMonth } from './months.js';
import { listPeople } from './people.js';

interface FixedLine {
  month: string;
  category_id: string;
  subcategory_id: string | null;
  planned_cents: number;
  fixed_day: number;
  default_payer_id: string | null;
  default_split: 'income' | 'equal' | 'personal';
}

/**
 * Creates, as "à confirmer", the fixed expenses that are due and not generated yet. A generated
 * expense is remembered so deleting it never brings it back.
 */
export function generateFixedExpenses(ctx: AppContext): number {
  const { db } = ctx;
  const people = listPeople(db);
  if (people.length === 0) return 0;
  const todayIso = today(ctx);
  const current = thisMonth(ctx);
  const firstPerson = people[0]?.id as string;

  const lines = db
    .prepare(
      `SELECT l.month, l.category_id, l.subcategory_id, l.planned_cents, c.fixed_day, c.default_payer_id, c.default_split
       FROM budget_lines l
       JOIN categories c ON c.id = l.category_id
       JOIN months m ON m.month = l.month
       WHERE m.fixed_enabled = 1 AND c.kind = 'fixed' AND c.archived = 0 AND l.planned_cents > 0 AND l.month <= ?
       ORDER BY l.month, c.position`,
    )
    .all(current) as FixedLine[];

  const seen = db.prepare(
    'SELECT 1 FROM fixed_generated WHERE month = ? AND category_id = ? AND subcategory_id = ?',
  );
  const remember = db.prepare(
    'INSERT INTO fixed_generated (month, category_id, subcategory_id) VALUES (?, ?, ?)',
  );

  let created = 0;
  db.transaction(() => {
    for (const line of lines) {
      const date = dateInMonth(line.month, line.fixed_day);
      if (date > todayIso) continue;
      const subKey = line.subcategory_id ?? '';
      if (seen.get(line.month, line.category_id, subKey)) continue;

      const payerId = line.default_payer_id ?? firstPerson;
      createExpense(
        db,
        {
          date,
          amountCents: line.planned_cents,
          categoryId: line.category_id,
          subcategoryId: line.subcategory_id,
          payerId,
          splitMode: line.default_split === 'personal' ? 'single' : line.default_split,
          singleId: line.default_split === 'personal' ? payerId : null,
          customBp: null,
          tags: [],
          note: '',
        },
        { createdBy: 'auto', status: 'pending', auto: true },
      );
      remember.run(line.month, line.category_id, subKey);
      created += 1;
    }
  })();
  return created;
}

/** Idempotent housekeeping run at startup, hourly, and when the app is opened. */
export function runDailyTasks(ctx: AppContext): { monthCreated: boolean; fixedCreated: number } {
  if (listPeople(ctx.db).length === 0) return { monthCreated: false, fixedCreated: 0 };
  ensureSystemCategory(ctx.db);
  const month: MonthKey = thisMonth(ctx);
  const monthCreated = ensureMonth(ctx.db, month, { withFixed: true });
  const fixedCreated = generateFixedExpenses(ctx);
  return { monthCreated, fixedCreated };
}

