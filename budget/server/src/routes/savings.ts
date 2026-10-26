import type { FastifyInstance } from 'fastify';
import {
  savingsAccountCreateSchema,
  savingsAccountUpdateSchema,
  savingsEntryUpsertSchema,
} from '@budget/shared';
import type { AppContext } from '../context.js';
import { parse } from '../http.js';
import { buildSavingsOverview, createAccount, updateAccount, upsertEntry } from '../services/savings.js';

export function savingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/savings', async () => buildSavingsOverview(ctx));

  app.post('/api/savings/accounts', async (req, reply) =>
    reply.status(201).send({ id: createAccount(db, parse(savingsAccountCreateSchema, req.body)) }),
  );

  app.patch<{ Params: { id: string } }>('/api/savings/accounts/:id', async (req) => {
    updateAccount(db, req.params.id, parse(savingsAccountUpdateSchema, req.body));
    return { ok: true };
  });

  app.put('/api/savings/entries', async (req) => {
    upsertEntry(db, parse(savingsEntryUpsertSchema, req.body));
    return buildSavingsOverview(ctx);
  });
}
