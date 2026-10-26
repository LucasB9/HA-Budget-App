import { currentMonth, todayInParis, type MonthKey } from '@budget/shared';
import type { AiClient } from './ai/client.js';
import type { AppConfig } from './config.js';
import type { Db } from './db/connection.js';

export interface AppContext {
  db: Db;
  config: AppConfig;
  /** Null when no Anthropic API key is configured. */
  ai: AiClient | null;
  /** Injectable clock, so tests can pin "today". */
  now: () => Date;
}

export function today(ctx: AppContext): string {
  return todayInParis(ctx.now());
}

export function thisMonth(ctx: AppContext): MonthKey {
  return currentMonth(ctx.now());
}
