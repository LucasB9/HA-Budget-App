import { currentMonth, todayInParis, type MonthKey } from '@budget/shared';
import type { AppConfig } from './config.js';
import type { Db } from './db/connection.js';

export interface AppContext {
  db: Db;
  config: AppConfig;
  /** Injectable clock, so tests can pin "today". */
  now: () => Date;
}

export function today(ctx: AppContext): string {
  return todayInParis(ctx.now());
}

export function thisMonth(ctx: AppContext): MonthKey {
  return currentMonth(ctx.now());
}
