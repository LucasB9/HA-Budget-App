import type { FastifyInstance } from 'fastify';
import {
  confirmExpenseSchema,
  expenseInputSchema,
  expenseQuerySchema,
  monthKeySchema,
  settlementCreateSchema,
  type TagSummaryRow,
} from '@budget/shared';
import { thisMonth, type AppContext } from '../context.js';
import { actorOf, parse } from '../http.js';
import { buildBalance, createSettlement, deleteSettlement } from '../services/balance.js';
import {
  confirmExpense,
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  listTags,
  updateExpense,
} from '../services/expenses.js';

export function expenseRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/expenses', async (req) => listExpenses(db, parse(expenseQuerySchema, req.query)));

  app.get<{ Params: { id: string } }>('/api/expenses/:id', async (req) => getExpense(db, req.params.id));

  app.post('/api/expenses', async (req, reply) => {
    const expense = createExpense(db, parse(expenseInputSchema, req.body), { createdBy: actorOf(req) });
    return reply.status(201).send(expense);
  });

  app.put<{ Params: { id: string } }>('/api/expenses/:id', async (req) =>
    updateExpense(db, req.params.id, parse(expenseInputSchema, req.body)),
  );

  app.delete<{ Params: { id: string } }>('/api/expenses/:id', async (req, reply) => {
    deleteExpense(db, req.params.id);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/expenses/:id/confirm', async (req) => {
    const { amountCents } = parse(confirmExpenseSchema, req.body ?? {});
    return confirmExpense(db, req.params.id, amountCents);
  });

  app.get('/api/tags', async () => listTags(db));

  app.get('/api/tags/summary', async (): Promise<TagSummaryRow[]> => {
    const rows = db
      .prepare(
        `SELECT t.name AS tag, e.month AS month, e.category_id AS category_id, e.amount_cents AS amount
         FROM expense_tags et JOIN tags t ON t.id = et.tag_id JOIN expenses e ON e.id = et.expense_id`,
      )
      .all() as { tag: string; month: string; category_id: string; amount: number }[];
    const byTag = new Map<string, TagSummaryRow>();
    for (const r of rows) {
      const row = byTag.get(r.tag) ?? { tag: r.tag, totalCents: 0, count: 0, byMonth: {}, byCategory: {} };
      row.totalCents += r.amount;
      row.count += 1;
      row.byMonth[r.month] = (row.byMonth[r.month] ?? 0) + r.amount;
      row.byCategory[r.category_id] = (row.byCategory[r.category_id] ?? 0) + r.amount;
      byTag.set(r.tag, row);
    }
    return [...byTag.values()].sort((a, b) => b.totalCents - a.totalCents);
  });

  app.get('/api/balance', async (req) => {
    const query = req.query as { month?: string };
    const month = query.month ? parse(monthKeySchema, query.month) : thisMonth(ctx);
    return buildBalance(db, month);
  });

  app.post('/api/settlements', async (req, reply) =>
    reply.status(201).send(createSettlement(db, parse(settlementCreateSchema, req.body))),
  );

  app.delete<{ Params: { id: string } }>('/api/settlements/:id', async (req, reply) => {
    deleteSettlement(db, req.params.id);
    return reply.status(204).send();
  });
}
