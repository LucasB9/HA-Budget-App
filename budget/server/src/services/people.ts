import type { PersonDto, Settings } from '@budget/shared';
import type { Db } from '../db/connection.js';
import { badRequest } from '../errors.js';

interface PersonRow {
  id: string;
  name: string;
  ha_user_name: string | null;
  position: number;
}

export function listPeople(db: Db): PersonDto[] {
  const rows = db.prepare('SELECT * FROM people ORDER BY position').all() as PersonRow[];
  return rows.map((r) => ({ id: r.id, name: r.name, haUserName: r.ha_user_name, position: r.position }));
}

export function personIds(db: Db): string[] {
  return listPeople(db).map((p) => p.id);
}

export function requirePerson(db: Db, id: string): PersonDto {
  const person = listPeople(db).find((p) => p.id === id);
  if (!person) throw badRequest(`Unknown person: ${id}`, 'unknown_person');
  return person;
}

export function updatePeople(
  db: Db,
  input: { id: string; name: string; haUserName?: string | null | undefined }[],
): PersonDto[] {
  const existing = new Set(personIds(db));
  const update = db.prepare('UPDATE people SET name = ?, ha_user_name = ? WHERE id = ?');
  db.transaction(() => {
    for (const p of input) {
      if (!existing.has(p.id)) throw badRequest(`Unknown person: ${p.id}`, 'unknown_person');
      update.run(p.name.trim(), p.haUserName?.trim() || null, p.id);
    }
  })();
  return listPeople(db);
}

/** Finds the person matching a Home Assistant user, by configured HA name or by display name. */
export function matchHaUser(people: readonly PersonDto[], names: (string | null)[]): string | null {
  const candidates = names.filter((n): n is string => !!n).map((n) => n.trim().toLowerCase());
  for (const person of people) {
    const keys = [person.haUserName, person.name].filter((k): k is string => !!k).map((k) => k.toLowerCase());
    if (candidates.some((c) => keys.includes(c))) return person.id;
  }
  return null;
}

// ------------------------------------------------------------------ settings

const DEFAULT_SETTINGS: Settings = {
  defaultSplitMode: 'income',
  autoRecap: false,
  savingsGoalCents: null,
  savingsGoalDate: null,
};

export function getSettings(db: Db): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const stored: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value);
    } catch {
      // ignore unreadable values and fall back to defaults
    }
  }
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
}

export function updateSettings(db: Db, patch: Partial<Settings>): Settings {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) upsert.run(key, JSON.stringify(value));
    }
  })();
  return getSettings(db);
}
