import {
  addMonths,
  formatMonthFr,
  ratioFromWeights,
  type Cents,
  type DashboardCategory,
  type ExpenseDto,
  type MonthKey,
} from '@budget/shared';
import { today, type AppContext } from '../context.js';
import { buildBalance } from '../services/balance.js';
import { buildDashboard } from '../services/dashboard.js';
import { listExpenses } from '../services/expenses.js';
import { getWeights, listMonthKeys, monthExists } from '../services/months.js';
import { listPeople } from '../services/people.js';
import { buildSavingsOverview } from '../services/savings.js';
import { getCatalog } from '../services/catalog.js';
import { listTransfers } from '../services/transfers.js';

const eur = (cents: Cents): number => Math.round(cents) / 100;
const pct = (ratio: number): number => Math.round(ratio * 1000) / 10;

/** How many previous months are compared against. */
const HISTORY_MONTHS = 3;
const MAX_NOTABLE_EXPENSES = 20;
/** A category is "unusual" when spent exceeds its recent average by this ratio and this many cents. */
const UNUSUAL_RATIO = 1.3;
const UNUSUAL_MIN_DELTA = 2000;

interface PreviousSpend {
  months: number;
  lastMonth: Cents | null;
  average: Cents | null;
}

function previousSpend(ctx: AppContext, month: MonthKey): Map<string, PreviousSpend> {
  const previous = listMonthKeys(ctx.db)
    .filter((m) => m < month)
    .slice(-HISTORY_MONTHS);
  const spentBy = new Map<string, Cents[]>();
  for (const m of previous) {
    for (const group of buildDashboard(ctx, m).groups) {
      for (const c of group.categories) spentBy.set(c.categoryId, [...(spentBy.get(c.categoryId) ?? []), c.spent]);
    }
  }
  const result = new Map<string, PreviousSpend>();
  for (const [categoryId, values] of spentBy) {
    result.set(categoryId, {
      months: values.length,
      lastMonth: values.at(-1) ?? null,
      average: values.length > 0 ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null,
    });
  }
  return result;
}

function splitLabel(e: ExpenseDto, names: Map<string, string>): string {
  switch (e.splitMode) {
    case 'income':
      return 'au prorata des revenus';
    case 'equal':
      return '50/50';
    case 'single':
      return `100 % ${names.get(e.singleId ?? '') ?? ''}`.trim();
    case 'custom':
      return 'pourcentages personnalisés';
  }
}

function categoryEntry(
  c: DashboardCategory,
  groupName: string,
  history: PreviousSpend | undefined,
): Record<string, unknown> {
  const average = history?.average ?? null;
  const unusual =
    average !== null && c.kind !== 'fixed' && c.spent > average * UNUSUAL_RATIO && c.spent - average >= UNUSUAL_MIN_DELTA;
  return {
    groupe: groupName,
    categorie: c.name,
    type: { fixed: 'fixe', variable: 'variable', provision: 'provision', system: 'imprévus' }[c.kind],
    budgetPrevu: eur(c.planned),
    virementsNets: eur(c.transfersIn - c.transfersOut),
    reportDuMoisPrecedent: eur(c.carryIn),
    budgetDisponible: eur(c.effective),
    depense: eur(c.spent),
    reste: eur(c.remaining),
    statut: c.status === 'over' ? 'budget atteint ou dépassé' : c.status === 'warn' ? 'au-dessus de 80 %' : 'ok',
    ...(c.subLines.length > 0
      ? { sousLignes: c.subLines.map((s) => ({ nom: s.name, prevu: eur(s.planned), depense: eur(s.spent) })) }
      : {}),
    ...(history
      ? {
          moisPrecedent: history.lastMonth === null ? null : eur(history.lastMonth),
          moyenneDesMoisPrecedents: average === null ? null : eur(average),
          nombreDeMoisCompares: history.months,
          nettementAuDessusDeLaMoyenne: unusual,
        }
      : {}),
  };
}

/**
 * The aggregated data sent to the model. Only what the recap needs: budget vs spent per category,
 * notable expenses with their notes and tags, savings movements and the balance between the two
 * people. Never identifiers, account numbers or bank details.
 */
export function buildRecapPayload(ctx: AppContext, month: MonthKey): Record<string, unknown> {
  const { db } = ctx;
  const people = listPeople(db);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const dash = buildDashboard(ctx, month);
  const history = previousSpend(ctx, month);
  const catalogNames = new Map(getCatalog(db).flatMap((g) => g.categories.map((c) => [c.id, c.name] as const)));
  const subNames = new Map(
    getCatalog(db).flatMap((g) => g.categories.flatMap((c) => c.subcategories.map((s) => [s.id, s.name] as const))),
  );

  const expenses = listExpenses(db, { month }, 10_000);
  const confirmed = expenses.filter((e) => e.status === 'confirmed');
  const expenseLine = (e: ExpenseDto): Record<string, unknown> => ({
    date: e.date,
    categorie: [catalogNames.get(e.categoryId), e.subcategoryId ? subNames.get(e.subcategoryId) : null]
      .filter(Boolean)
      .join(' › '),
    montant: eur(e.amountCents),
    payePar: names.get(e.payerId) ?? '',
    repartition: splitLabel(e, names),
    ...(e.note ? { note: e.note } : {}),
    ...(e.tags.length > 0 ? { tags: e.tags } : {}),
  });
  // Recurring fixed expenses without a note are not news; everything else is a candidate.
  const candidates = confirmed.filter((e) => !(e.auto && e.note === ''));
  const byAmount = [...candidates].sort((a, b) => b.amountCents - a.amountCents).slice(0, MAX_NOTABLE_EXPENSES);
  const withNotes = candidates.filter((e) => e.note !== '');
  const notable = [...new Map([...byAmount, ...withNotes].map((e) => [e.id, e])).values()]
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, MAX_NOTABLE_EXPENSES * 2);

  const tagTotals = new Map<string, { total: Cents; count: number }>();
  for (const e of expenses) {
    for (const tag of e.tags) {
      const t = tagTotals.get(tag) ?? { total: 0, count: 0 };
      t.total += e.amountCents;
      t.count += 1;
      tagTotals.set(tag, t);
    }
  }

  const weights = monthExists(db, month) ? getWeights(db, month) : {};
  const ratio = ratioFromWeights(weights, people.map((p) => p.id));
  const balance = buildBalance(db, month);
  const describeDebt = (debt: typeof balance.monthBalance.debt): string | null =>
    debt ? `${names.get(debt.debtorId)} doit ${eur(debt.amountCents)} € à ${names.get(debt.creditorId)}` : null;
  const settlementsOfMonth = balance.settlements.filter((s) => s.date.startsWith(month));

  const savings = buildSavingsOverview(ctx);
  const point = savings.series.find((p) => p.month === month);
  const stat = savings.monthStats.find((s) => s.month === month);
  const entriesOfMonth = savings.entries.filter((e) => e.month === month);

  const todayIso = today(ctx);
  const monthIsOver = addMonths(month, 1) <= todayIso.slice(0, 7);

  return {
    mois: formatMonthFr(month),
    moisTermine: monthIsOver,
    ...(monthIsOver ? {} : { dateDuJour: todayIso }),
    foyer: {
      personnes: people.map((p) => p.name),
      repartitionSelonLesRevenusEnPourcent: Object.fromEntries(people.map((p) => [p.name, pct(ratio[p.id] ?? 0)])),
    },
    totaux: {
      revenusDuFoyer: eur(dash.totals.income),
      budgetPrevu: eur(dash.totals.planned),
      budgetDisponible: eur(dash.totals.effective),
      depense: eur(dash.totals.spent),
      reste: eur(dash.totals.remaining),
      resteAEpargnerPrevu: eur(dash.totals.plannedBalance),
      resteReelApresDepenses: eur(dash.totals.actualBalance),
      ...(monthIsOver ? {} : { projectionFinDeMois: eur(dash.totals.projected) }),
    },
    categories: dash.groups.flatMap((g) => g.categories.map((c) => categoryEntry(c, g.name, history.get(c.categoryId)))),
    depensesNotables: notable.map(expenseLine),
    tags: [...tagTotals.entries()].map(([tag, t]) => ({ tag, total: eur(t.total), nombreDeDepenses: t.count })),
    imprevus: { nombreDeDepenses: dash.imprevusCount, total: eur(dash.imprevusCents) },
    virementsEntreEnveloppes: listTransfers(db, month).map((t) => ({
      de: catalogNames.get(t.fromCategoryId),
      vers: catalogNames.get(t.toCategoryId),
      montant: eur(t.amountCents),
      ...(t.note ? { note: t.note } : {}),
    })),
    epargne: {
      versementsDuMois: eur(point?.contributionCents ?? 0),
      tauxDEpargneEnPourcent: stat?.rate != null ? pct(stat.rate) : null,
      montantPrevuAEpargner: stat?.plannedCents != null ? eur(stat.plannedCents) : null,
      totalVerseTousComptes: eur(point?.cumulativeCents ?? 0),
      valeurTotaleSelonLesSoldes: point?.balanceCents != null ? eur(point.balanceCents) : null,
      comptes: savings.accounts
        .filter((a) => !a.archived)
        .map((a) => {
          const entry = entriesOfMonth.find((e) => e.accountId === a.id);
          return {
            nom: a.name,
            type: a.kind || null,
            versementDuMois: eur(entry?.contributionCents ?? 0),
            ...(entry?.note ? { note: entry.note } : {}),
            soldeFinDeMois: entry?.balanceCents != null ? eur(entry.balanceCents) : null,
            totalVerse: eur(a.contributionsCents),
            objectif: a.goalCents ? eur(a.goalCents) : null,
            progressionVersObjectifEnPourcent: a.progress !== null ? pct(a.progress) : null,
          };
        }),
      objectifGlobal: savings.goal
        ? {
            cible: eur(savings.goal.targetCents),
            atteint: eur(savings.goal.currentCents),
            progressionEnPourcent: pct(savings.goal.progress),
          }
        : null,
    },
    equilibreEntreLesDeux: {
      soldeDuMois: describeDebt(balance.monthBalance.debt) ?? 'à jour',
      soldeGlobal: describeDebt(balance.overallBalance.debt) ?? 'à jour',
      remboursementsDuMois: settlementsOfMonth.map((s) => ({
        de: names.get(s.fromId),
        a: names.get(s.toId),
        montant: eur(s.amountCents),
      })),
      depensesFixesAConfirmerNonComptees: { nombre: balance.pendingCount, total: eur(balance.pendingCents) },
    },
  };
}
