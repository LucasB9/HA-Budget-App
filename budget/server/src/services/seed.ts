import { eurosToCents, type Cents, type Seed } from '@budget/shared';
import { thisMonth, type AppContext } from '../context.js';
import { newId } from '../db/connection.js';
import { badRequest, conflict } from '../errors.js';
import { createCategory, createGroup, createSubcategory, ensureSystemCategory } from './catalog.js';
import { generateFixedExpenses } from './fixed.js';
import { ensureMonth } from './months.js';
import { listPeople, updateSettings } from './people.js';

export interface SeedResult {
  groups: number;
  categories: number;
  subLines: number;
  plannedCents: Cents;
}

/**
 * Loads a seed (household, budget template, current-month incomes). Only allowed while the
 * template is empty; a full restore goes through the JSON backup instead.
 */
export function importSeed(ctx: AppContext, seed: Seed): SeedResult {
  const { db } = ctx;
  const existing = (
    db.prepare('SELECT COUNT(*) AS n FROM categories WHERE is_system = 0').get() as { n: number }
  ).n;
  if (existing > 0) throw conflict('A budget already exists. Use the JSON backup restore to replace it.', 'already_seeded');

  const names = seed.people.map((p) => p.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) throw badRequest('The two people must have different names');
  const resolvePerson = (name: string | undefined, fallbackId: string, people: { id: string; name: string }[]): string => {
    if (!name) return fallbackId;
    const match = people.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
    if (!match) throw badRequest(`Unknown payer in seed: ${name}`);
    return match.id;
  };

  const result: SeedResult = { groups: 0, categories: 0, subLines: 0, plannedCents: 0 };

  db.transaction(() => {
    if (listPeople(db).length === 0) {
      const insert = db.prepare('INSERT INTO people (id, name, position) VALUES (?, ?, ?)');
      seed.people.forEach((p, i) => insert.run(`p${i + 1}`, p.name.trim(), i));
    } else {
      seed.people.forEach((p, i) => db.prepare('UPDATE people SET name = ? WHERE id = ?').run(p.name.trim(), `p${i + 1}`));
    }
    const people = listPeople(db);
    const firstPerson = people[0]?.id as string;
    updateSettings(db, { defaultSplitMode: seed.defaultSplitMode });

    for (const group of seed.groups) {
      const groupId = createGroup(db, group.name);
      result.groups += 1;
      for (const cat of group.categories) {
        const subTotal = (cat.sublines ?? []).reduce((s, l) => s + l.amount, 0);
        if (cat.sublines && cat.sublines.length > 0 && Math.round(subTotal * 100) !== Math.round(cat.amount * 100)) {
          throw badRequest(`Sub-lines of "${cat.name}" add up to ${subTotal}, expected ${cat.amount}`);
        }
        const categoryId = createCategory(db, {
          groupId,
          name: cat.name,
          kind: cat.type,
          plannedCents: eurosToCents(cat.amount),
          rollover: cat.rollover,
          fixedDay: cat.day,
          defaultPayerId: resolvePerson(cat.payer, firstPerson, people),
          defaultSplit: cat.split ?? seed.defaultSplitMode,
        });
        result.categories += 1;
        result.plannedCents += eurosToCents(cat.amount);
        for (const line of cat.sublines ?? []) {
          createSubcategory(db, { categoryId, name: line.name, plannedCents: eurosToCents(line.amount) });
          result.subLines += 1;
        }
      }
    }
    ensureSystemCategory(db);

    const incomes: Record<string, Cents> = {};
    seed.people.forEach((p, i) => {
      incomes[`p${i + 1}`] = eurosToCents(p.monthlyIncome);
    });
    ensureMonth(db, thisMonth(ctx), { incomes, withFixed: true });

    const insertAccount = db.prepare(
      'INSERT INTO savings_accounts (id, name, kind, goal_cents, goal_date, position) VALUES (?, ?, ?, ?, ?, ?)',
    );
    seed.savingsAccounts.forEach((a, i) =>
      insertAccount.run(
        newId(),
        a.name,
        a.kind,
        a.goalAmount === undefined ? null : eurosToCents(a.goalAmount),
        a.goalDate ?? null,
        i,
      ),
    );
    generateFixedExpenses(ctx);
  })();

  return result;
}
