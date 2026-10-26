import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AppConfig {
  port: number;
  host: string;
  dbPath: string;
  webDir: string;
  seedExamplePath: string;
  anthropicApiKey: string | null;
  anthropicModel: string;
  /** Reject requests that do not come from the Supervisor ingress gateway. */
  enforceIngress: boolean;
  /** Present when running as a Home Assistant app. */
  supervisorToken: string | null;
  shortcutToken: string | null;
  version: string;
}

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const INGRESS_GATEWAY_IP = '172.30.32.2';

interface HaOptions {
  anthropic_api_key?: string;
  anthropic_model?: string;
  shortcut_token?: string;
}

function readHaOptions(): HaOptions {
  const path = process.env.OPTIONS_PATH ?? '/data/options.json';
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as HaOptions;
  } catch {
    return {};
  }
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const options = readHaOptions();
  const supervisorToken = nonEmpty(env.SUPERVISOR_TOKEN);
  const dataDir = env.DATA_DIR ?? (supervisorToken ? '/data' : resolve(process.cwd(), '.data'));
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    dbPath: env.DB_PATH ?? resolve(dataDir, 'budget.db'),
    webDir: resolve(env.WEB_DIR ?? resolve(process.cwd(), 'web/dist')),
    seedExamplePath: resolve(env.SEED_EXAMPLE_PATH ?? resolve(process.cwd(), 'seed.example.json')),
    anthropicApiKey: nonEmpty(options.anthropic_api_key) ?? nonEmpty(env.ANTHROPIC_API_KEY),
    anthropicModel: nonEmpty(options.anthropic_model) ?? nonEmpty(env.ANTHROPIC_MODEL) ?? DEFAULT_MODEL,
    enforceIngress: env.INGRESS_ONLY === 'true' || (supervisorToken !== null && env.INGRESS_ONLY !== 'false'),
    supervisorToken,
    shortcutToken: nonEmpty(options.shortcut_token) ?? nonEmpty(env.SHORTCUT_TOKEN),
    version: env.APP_VERSION ?? '0.0.0-dev',
  };
}
