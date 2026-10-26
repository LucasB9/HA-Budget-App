import { addMonths, type MonthKey, type RecapDto } from '@budget/shared';
import { AiError } from '../ai/client.js';
import { buildRecapPayload } from '../ai/recap-payload.js';
import { RECAP_SYSTEM_PROMPT, recapUserMessage } from '../ai/recap-prompt.js';
import { thisMonth, today, type AppContext } from '../context.js';
import { newId, nowIso, type Db } from '../db/connection.js';
import { conflict, HttpError } from '../errors.js';
import { requireMonth } from './months.js';
import { getSettings } from './people.js';

interface RecapRow {
  id: string;
  month: string;
  created_at: string;
  model: string;
  trigger: 'manual' | 'auto';
  content: string;
  input_tokens: number | null;
  output_tokens: number | null;
}

/** A recap is about 1 000 words at most; the rest of the budget is room for the model's reasoning. */
const MAX_OUTPUT_TOKENS = 8000;

/** Months being generated right now, so a double click cannot produce two recaps and two bills. */
const inFlight = new Set<string>();

function toDto(r: RecapRow): RecapDto {
  return {
    id: r.id,
    month: r.month,
    createdAt: r.created_at,
    model: r.model,
    trigger: r.trigger,
    content: r.content,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
  };
}

export function listRecaps(db: Db, month?: MonthKey): RecapDto[] {
  const rows = month
    ? (db.prepare('SELECT * FROM recaps WHERE month = ? ORDER BY created_at DESC').all(month) as RecapRow[])
    : (db.prepare('SELECT * FROM recaps ORDER BY created_at DESC').all() as RecapRow[]);
  return rows.map(toDto);
}

function httpErrorFor(err: AiError): HttpError {
  switch (err.kind) {
    case 'auth':
      return new HttpError(502, 'ai_auth', err.message);
    case 'rate_limit':
      return new HttpError(429, 'ai_rate_limit', err.message);
    case 'refusal':
      return new HttpError(502, 'ai_refused', err.message);
    case 'bad_request':
      return new HttpError(502, 'ai_bad_request', err.message);
    default:
      return new HttpError(502, 'ai_error', err.message);
  }
}

/** Generates the recap of a month from aggregated data only, and stores it. */
export async function generateRecap(ctx: AppContext, month: MonthKey, trigger: 'manual' | 'auto'): Promise<RecapDto> {
  const { db, ai, config } = ctx;
  if (!ai) {
    throw new HttpError(
      400,
      'ai_not_configured',
      "Aucune clé API Anthropic n'est configurée. Renseignez-la dans les options de l'app Home Assistant.",
    );
  }
  requireMonth(db, month);
  if (inFlight.has(month)) throw conflict('Un récap est déjà en cours de génération pour ce mois', 'recap_in_progress');

  inFlight.add(month);
  try {
    const payload = buildRecapPayload(ctx, month);
    const result = await ai.generate({
      model: config.anthropicModel,
      system: RECAP_SYSTEM_PROMPT,
      user: recapUserMessage(payload),
      maxTokens: MAX_OUTPUT_TOKENS,
    });
    const id = newId();
    db.prepare(
      `INSERT INTO recaps (id, month, created_at, model, trigger, content, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, month, nowIso(), result.model, trigger, result.text, result.inputTokens, result.outputTokens);
    return toDto(db.prepare('SELECT * FROM recaps WHERE id = ?').get(id) as RecapRow);
  } catch (err) {
    if (err instanceof AiError) throw httpErrorFor(err);
    throw err;
  } finally {
    inFlight.delete(month);
  }
}

/** Auto-run attempts are spaced out so a broken key does not hammer the API every hour. */
const AUTO_RETRY_MS = 6 * 60 * 60 * 1000;
const lastAutoAttempt = new Map<string, number>();

/**
 * On the first days of a month, writes the recap of the month that just ended, once. It stays quiet
 * when the setting is off, no key is configured, nothing was spent, or a recap already exists.
 */
export async function runAutoRecap(ctx: AppContext): Promise<RecapDto | null> {
  if (!ctx.ai || !getSettings(ctx.db).autoRecap) return null;
  const todayIso = today(ctx);
  if (Number(todayIso.slice(8, 10)) > 5) return null;

  const month = addMonths(thisMonth(ctx), -1);
  const hasMonth = ctx.db.prepare('SELECT 1 FROM months WHERE month = ?').get(month) !== undefined;
  const spent = ctx.db.prepare('SELECT 1 FROM expenses WHERE month = ? LIMIT 1').get(month) !== undefined;
  if (!hasMonth || !spent) return null;
  if (ctx.db.prepare('SELECT 1 FROM recaps WHERE month = ? LIMIT 1').get(month)) return null;

  const last = lastAutoAttempt.get(month) ?? 0;
  if (ctx.now().getTime() - last < AUTO_RETRY_MS) return null;
  lastAutoAttempt.set(month, ctx.now().getTime());
  return generateRecap(ctx, month, 'auto');
}

/** Test hook: forget the retry spacing. */
export function resetAutoRecapState(): void {
  lastAutoAttempt.clear();
  inFlight.clear();
}
