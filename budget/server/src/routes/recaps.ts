import type { FastifyInstance } from 'fastify';
import { monthKeySchema, recapRequestSchema } from '@budget/shared';
import { buildRecapPayload } from '../ai/recap-payload.js';
import type { AppContext } from '../context.js';
import { parse } from '../http.js';
import { requireMonth } from '../services/months.js';
import { generateRecap, listRecaps } from '../services/recap.js';

export function recapRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/recaps', async (req) => {
    const { month } = req.query as { month?: string };
    return listRecaps(ctx.db, month ? parse(monthKeySchema, month) : undefined);
  });

  /** Exactly what would be sent to the model, so the household can check nothing private leaves. */
  app.get<{ Querystring: { month?: string } }>('/api/recaps/preview', async (req) => {
    const month = parse(monthKeySchema, req.query.month);
    requireMonth(ctx.db, month);
    return buildRecapPayload(ctx, month);
  });

  app.post('/api/recaps', async (req, reply) => {
    const { month } = parse(recapRequestSchema, req.body);
    return reply.status(201).send(await generateRecap(ctx, month, 'manual'));
  });
}
