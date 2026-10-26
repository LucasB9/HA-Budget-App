import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { monthKeySchema } from '@budget/shared';
import type { AppContext } from '../context.js';
import { actorOf, parse } from '../http.js';
import { backupSchema, exportBackup, restoreBackup } from '../services/backup.js';
import { exportExpensesCsv, exportSavingsCsv, importExpensesCsv, importSavingsCsv } from '../services/data-csv.js';

const restoreSchema = z.object({ confirm: z.literal('RESTAURER'), backup: backupSchema });

function dateStamp(ctx: AppContext): string {
  return ctx.now().toISOString().slice(0, 10);
}

export function dataRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.get('/api/backup', async (_req, reply) =>
    reply
      .header('Content-Disposition', `attachment; filename="budget-sauvegarde-${dateStamp(ctx)}.json"`)
      .type('application/json')
      .send(exportBackup(db)),
  );

  // A restore replaces everything: it needs an explicit confirmation word in the body.
  app.post('/api/backup/restore', { bodyLimit: 64 * 1024 * 1024 }, async (req) => {
    const { backup } = parse(restoreSchema, req.body);
    return restoreBackup(db, backup, ctx.config.dbPath);
  });

  app.get('/api/export/expenses.csv', async (req, reply) => {
    const { month } = req.query as { month?: string };
    return reply
      .header('Content-Disposition', `attachment; filename="depenses${month ? `-${month}` : ''}.csv"`)
      .type('text/csv; charset=utf-8')
      .send(exportExpensesCsv(ctx, month ? parse(monthKeySchema, month) : undefined));
  });

  app.get('/api/export/savings.csv', async (_req, reply) =>
    reply
      .header('Content-Disposition', 'attachment; filename="epargne.csv"')
      .type('text/csv; charset=utf-8')
      .send(exportSavingsCsv(ctx)),
  );

  app.post('/api/import/expenses', { bodyLimit: 16 * 1024 * 1024 }, async (req) => {
    const { dryRun } = req.query as { dryRun?: string };
    return importExpensesCsv(ctx, String(req.body ?? ''), { dryRun: dryRun === 'true', createdBy: actorOf(req) });
  });

  app.post('/api/import/savings', { bodyLimit: 16 * 1024 * 1024 }, async (req) => {
    const { dryRun } = req.query as { dryRun?: string };
    return importSavingsCsv(ctx, String(req.body ?? ''), { dryRun: dryRun === 'true' });
  });
}
