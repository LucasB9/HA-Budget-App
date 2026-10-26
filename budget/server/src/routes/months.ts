import type { FastifyInstance } from 'fastify';
import {
  budgetLineUpdateSchema,
  incomesUpdateSchema,
  monthKeySchema,
  transferCreateSchema,
  type MonthKey,
} from '@budget/shared';
import { thisMonth, type AppContext } from '../context.js';
import { parse } from '../http.js';
import { buildDashboard } from '../services/dashboard.js';
import { recalculateMonth } from '../services/expenses.js';
import { generateFixedExpenses } from '../services/fixed.js';
import {
  ensureMonth,
  getMonthDto,
  listMonthKeys,
  setBudgetLine,
  updateIncomes,
} from '../services/months.js';
import { createTransfer, deleteTransfer, listTransfers } from '../services/transfers.js';

export function monthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;
  const monthParam = (req: { params: unknown }): MonthKey => parse(monthKeySchema, (req.params as { month: string }).month);

  app.get('/api/months', async () => ({ months: listMonthKeys(db), current: thisMonth(ctx) }));

  app.post<{ Params: { month: string } }>('/api/months/:month', async (req, reply) => {
    const month = monthParam(req);
    const created = ensureMonth(db, month);
    generateFixedExpenses(ctx);
    return reply.status(created ? 201 : 200).send({ month, created });
  });

  app.get<{ Params: { month: string } }>('/api/months/:month', async (req) => getMonthDto(db, monthParam(req)));

  app.get<{ Params: { month: string } }>('/api/months/:month/dashboard', async (req) =>
    buildDashboard(ctx, monthParam(req)),
  );

  app.put<{ Params: { month: string } }>('/api/months/:month/incomes', async (req) => {
    const month = monthParam(req);
    updateIncomes(db, month, parse(incomesUpdateSchema, req.body).incomes);
    return getMonthDto(db, month);
  });

  app.post<{ Params: { month: string } }>('/api/months/:month/recalculate', async (req) => {
    const month = monthParam(req);
    const { updated } = recalculateMonth(db, month);
    return { month: getMonthDto(db, month), updatedExpenses: updated };
  });

  app.put<{ Params: { month: string } }>('/api/months/:month/lines', async (req) => {
    const month = monthParam(req);
    setBudgetLine(db, month, parse(budgetLineUpdateSchema, req.body));
    return buildDashboard(ctx, month);
  });

  app.get<{ Params: { month: string } }>('/api/months/:month/transfers', async (req) =>
    listTransfers(db, monthParam(req)),
  );

  app.post<{ Params: { month: string } }>('/api/months/:month/transfers', async (req, reply) =>
    reply.status(201).send(createTransfer(db, monthParam(req), parse(transferCreateSchema, req.body))),
  );

  app.delete<{ Params: { month: string; id: string } }>('/api/months/:month/transfers/:id', async (req, reply) => {
    deleteTransfer(db, monthParam(req), req.params.id);
    return reply.status(204).send();
  });
}
