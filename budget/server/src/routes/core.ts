import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { peopleUpdateSchema, seedSchema, settingsSchema, type SessionDto } from '@budget/shared';
import { thisMonth, today, type AppContext } from '../context.js';
import { notFound } from '../errors.js';
import { parse } from '../http.js';
import { runDailyTasks } from '../services/fixed.js';
import { getSettings, listPeople, matchHaUser, updatePeople, updateSettings } from '../services/people.js';
import { importSeed } from '../services/seed.js';

export function coreRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async () => ({ ok: true, version: ctx.config.version }));

  app.get('/api/session', async (req): Promise<SessionDto> => {
    const people = listPeople(ctx.db);
    if (people.length > 0) runDailyTasks(ctx);
    const haUser = req.haUser;
    return {
      people,
      me: haUser ? matchHaUser(people, [haUser.displayName, haUser.name]) : null,
      haUser,
      needsSetup: people.length === 0,
      settings: getSettings(ctx.db),
      version: ctx.config.version,
      aiConfigured: ctx.config.anthropicApiKey !== null,
      shortcutEnabled: ctx.config.shortcutToken !== null,
      inHomeAssistant: ctx.config.supervisorToken !== null,
      today: today(ctx),
      currentMonth: thisMonth(ctx),
    };
  });

  app.put('/api/people', async (req) => {
    const body = parse(peopleUpdateSchema, req.body);
    return updatePeople(ctx.db, body.people);
  });

  app.get('/api/settings', async () => getSettings(ctx.db));
  app.patch('/api/settings', async (req) => updateSettings(ctx.db, parse(settingsSchema.partial(), req.body)));

  app.get('/api/setup/example', async () => {
    try {
      return JSON.parse(readFileSync(ctx.config.seedExamplePath, 'utf8')) as unknown;
    } catch {
      throw notFound('Example seed not available', 'example_missing');
    }
  });

  app.post('/api/setup/seed', async (req, reply) => {
    const seed = parse(seedSchema, req.body);
    const result = importSeed(ctx, seed);
    return reply.status(201).send(result);
  });
}
