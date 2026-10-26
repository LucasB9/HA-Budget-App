import { z } from 'zod';
import { nowIso, type Db } from '../db/connection.js';
import { badRequest, conflict } from '../errors.js';

/** Every table, parents before children. Restores insert in this order and delete in reverse. */
const TABLES = [
  'people',
  'settings',
  'groups',
  'categories',
  'subcategories',
  'months',
  'month_incomes',
  'month_weights',
  'budget_lines',
  'envelope_transfers',
  'expenses',
  'expense_shares',
  'tags',
  'expense_tags',
  'fixed_generated',
  'settlements',
  'savings_accounts',
  'savings_entries',
  'recaps',
] as const;

export const BACKUP_FORMAT = 'household-budget-backup';

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(1),
  schemaVersion: z.number().int().min(1),
  exportedAt: z.string(),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))),
});
export type Backup = z.infer<typeof backupSchema>;

function schemaVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number;
}

export function exportBackup(db: Db): Backup {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    schemaVersion: schemaVersion(db),
    exportedAt: nowIso(),
    tables: Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all() as Backup['tables'][string]])),
  };
}

export interface RestoreResult {
  rows: number;
  safetyCopy: string | null;
}

/**
 * Replaces the whole database with a backup, atomically. A safety copy of the current database is
 * written next to it first (file databases only). Backups from an older schema are accepted: columns
 * the backup does not know about take their defaults. A newer schema is refused.
 */
export function restoreBackup(db: Db, backup: Backup, dbPath: string): RestoreResult {
  const current = schemaVersion(db);
  if (backup.schemaVersion > current) {
    throw conflict(
      `Cette sauvegarde vient d'une version plus récente de l'app (schéma ${backup.schemaVersion}, actuel ${current}). Mettez l'app à jour d'abord.`,
      'backup_too_new',
    );
  }
  for (const name of Object.keys(backup.tables)) {
    if (!(TABLES as readonly string[]).includes(name)) throw badRequest(`Table inconnue dans la sauvegarde : ${name}`, 'backup_invalid');
  }

  let safetyCopy: string | null = null;
  if (dbPath !== ':memory:') {
    safetyCopy = `${dbPath}.avant-restauration-${nowIso().replace(/[:.]/g, '-')}`;
    db.exec(`VACUUM INTO '${safetyCopy.replace(/'/g, "''")}'`);
  }

  let rows = 0;
  db.transaction(() => {
    db.pragma('defer_foreign_keys = ON');
    for (const table of [...TABLES].reverse()) db.prepare(`DELETE FROM ${table}`).run();
    for (const table of TABLES) {
      const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
      for (const row of backup.tables[table] ?? []) {
        const keys = Object.keys(row).filter((k) => columns.has(k));
        if (keys.length === 0) continue;
        db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(
          ...keys.map((k) => row[k] as string | number | null),
        );
        rows += 1;
      }
    }
    const violations = db.pragma('foreign_key_check') as unknown[];
    if (violations.length > 0) throw badRequest('La sauvegarde est incohérente (références manquantes)', 'backup_invalid');
  })();
  return { rows, safetyCopy };
}
