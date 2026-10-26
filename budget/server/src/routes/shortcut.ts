import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { formatEur, type ExpenseDto } from '@budget/shared';
import { today, type AppContext } from '../context.js';
import { HttpError, badRequest } from '../errors.js';
import { parse } from '../http.js';
import { ensureSystemCategory, getCatalog } from '../services/catalog.js';
import { normalizeName, parseAmountCents, parseDateFlexible } from '../services/csv.js';
import { createExpense } from '../services/expenses.js';
import { getSettings, listPeople } from '../services/people.js';

const bodySchema = z.object({
  amount: z.union([z.number(), z.string()]),
  category: z.string().max(80).optional(),
  payer: z.string().max(40).optional(),
  note: z.string().max(500).optional(),
  date: z.string().max(20).optional(),
  tags: z.union([z.array(z.string().max(40)).max(10), z.string().max(200)]).optional(),
  split: z.enum(['income', 'equal', 'personal']).optional(),
});

const sha = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Failed attempts per client address: a short, in-memory brute-force guard for the token. */
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; since: number }>();

export function resetShortcutGuard(): void {
  failures.clear();
}

function authenticate(ctx: AppContext, req: FastifyRequest): void {
  const token = ctx.config.shortcutToken;
  if (!token) throw new HttpError(404, 'shortcut_disabled', "L'endpoint Raccourcis n'est pas activé (option shortcut_token)");

  const key = req.ip;
  const now = ctx.now().getTime();
  const record = failures.get(key);
  if (record && now - record.since < FAILURE_WINDOW_MS && record.count >= MAX_FAILURES) {
    throw new HttpError(429, 'too_many_attempts', 'Trop de tentatives, réessayez plus tard');
  }

  const header = req.headers.authorization ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided || !timingSafeEqual(sha(provided), sha(token))) {
    const fresh = record && now - record.since < FAILURE_WINDOW_MS ? record : { count: 0, since: now };
    failures.set(key, { count: fresh.count + 1, since: fresh.since });
    throw new HttpError(401, 'unauthorized', 'Jeton invalide');
  }
  failures.delete(key);
}

/** Endpoints meant for an iOS Shortcut: a bearer token instead of the Home Assistant session. */
export function shortcutRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.addHook('preHandler', async (req: FastifyRequest, _reply: FastifyReply) => {
    if (req.url.startsWith('/api/shortcut/')) authenticate(ctx, req);
  });

  /** Names to offer in a Shortcut menu (Imprévus is the automatic fallback, so it is not listed). */
  app.get('/api/shortcut/options', async () => ({
    categories: getCatalog(db)
      .filter((g) => !g.archived)
      .flatMap((g) => g.categories.filter((c) => !c.archived && !c.isSystem).map((c) => c.name)),
    people: listPeople(db).map((p) => p.name),
  }));

  app.post('/api/shortcut/expense', async (req, reply) => {
    const body = parse(bodySchema, req.body);
    const people = listPeople(db);
    if (people.length === 0) throw badRequest("L'app n'est pas encore configurée", 'setup_required');

    const amountCents = typeof body.amount === 'number' ? Math.round(body.amount * 100) : parseAmountCents(body.amount);
    if (amountCents === null || amountCents <= 0) throw badRequest(`Montant invalide : ${String(body.amount)}`, 'invalid_amount');

    const date = body.date ? parseDateFlexible(body.date) : today(ctx);
    if (!date) throw badRequest(`Date invalide : ${body.date ?? ''}`, 'invalid_date');

    const categories = getCatalog(db).flatMap((g) => g.categories.filter((c) => !c.archived && !c.isSystem));
    const wanted = normalizeName(body.category ?? '');
    const matches = wanted ? categories.filter((c) => normalizeName(c.name) === wanted) : [];
    const loose = wanted && matches.length === 0 ? categories.filter((c) => normalizeName(c.name).includes(wanted)) : [];
    const category = matches[0] ?? (loose.length === 1 ? loose[0] : undefined);
    const categoryId = category?.id ?? ensureSystemCategory(db);
    const categoryName = category?.name ?? 'Imprévus';

    const payer = body.payer ? people.find((p) => normalizeName(p.name) === normalizeName(body.payer ?? '')) : people[0];
    if (!payer) throw badRequest(`Payeur inconnu : ${body.payer ?? ''}`, 'unknown_person');

    const split = body.split ?? getSettings(db).defaultSplitMode;
    const tags = (Array.isArray(body.tags) ? body.tags : (body.tags ?? '').split(/[,|]/)).map((t) => t.trim()).filter(Boolean);

    const expense: ExpenseDto = createExpense(
      db,
      {
        date,
        amountCents,
        categoryId,
        subcategoryId: null,
        payerId: payer.id,
        splitMode: split === 'personal' ? 'single' : split,
        singleId: split === 'personal' ? payer.id : null,
        customBp: null,
        tags,
        note: body.note ?? '',
      },
      { createdBy: 'raccourci' },
    );

    const fallback = wanted && !category ? ` (catégorie « ${body.category} » inconnue : classée en Imprévus)` : '';
    return reply.status(201).send({
      ok: true,
      id: expense.id,
      summary: `${formatEur(amountCents)} · ${categoryName} · payé par ${payer.name}${fallback}`,
    });
  });
}
