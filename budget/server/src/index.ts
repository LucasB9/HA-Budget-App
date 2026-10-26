import { createAnthropicClient } from './ai/client.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { AppContext } from './context.js';
import { openDatabase } from './db/connection.js';
import { runDailyTasks } from './services/fixed.js';
import { runAutoRecap } from './services/recap.js';

const HOUR_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig();
  const ctx: AppContext = {
    db: openDatabase(config.dbPath),
    config,
    ai: config.anthropicApiKey ? createAnthropicClient(config.anthropicApiKey) : null,
    now: () => new Date(),
  };
  const app = buildApp(ctx, { logger: true });

  const housekeeping = (): void => {
    try {
      const result = runDailyTasks(ctx);
      if (result.monthCreated || result.fixedCreated > 0) app.log.info(result, 'daily tasks');
    } catch (err) {
      app.log.error({ err }, 'daily tasks failed');
    }
    runAutoRecap(ctx)
      .then((recap) => {
        if (recap) app.log.info({ month: recap.month }, 'monthly recap generated');
      })
      .catch((err: unknown) => app.log.warn({ err }, 'automatic recap failed'));
  };
  housekeeping();
  const timer = setInterval(housekeeping, HOUR_MS);
  timer.unref();

  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    await app.close();
    ctx.db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
