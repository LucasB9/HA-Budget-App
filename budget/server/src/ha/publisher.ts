import { formatEur } from '@budget/shared';
import { thisMonth, type AppContext } from '../context.js';
import { buildBalance } from '../services/balance.js';
import { buildDashboard } from '../services/dashboard.js';
import { monthExists } from '../services/months.js';
import { listPeople } from '../services/people.js';

export interface HaClient {
  setState(entityId: string, state: string | number, attributes: Record<string, unknown>): Promise<void>;
}

/** Talks to Home Assistant Core through the Supervisor proxy (needs `homeassistant_api: true`). */
export function createHaClient(token: string, baseUrl = 'http://supervisor/core/api'): HaClient {
  return {
    async setState(entityId, state, attributes) {
      const res = await fetch(`${baseUrl}/states/${entityId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, attributes }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Home Assistant a répondu ${res.status} pour ${entityId}`);
    },
  };
}

const eur = (cents: number): number => Math.round(cents) / 100;

export interface HaPublisher {
  /** Publishes soon, merging bursts of changes into one update. */
  schedule(): void;
  publishNow(): Promise<void>;
}

/**
 * Exposes a few values of the current month as Home Assistant sensors, for dashboards and
 * notifications. States set through the REST API do not survive a Home Assistant restart, so the
 * values are republished every hour and after every change.
 */
export function createHaPublisher(
  ctx: AppContext,
  client: HaClient,
  opts: { delayMs?: number; onError?: (err: unknown) => void } = {},
): HaPublisher {
  const delay = opts.delayMs ?? 3000;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const publishNow = async (): Promise<void> => {
    try {
      const month = thisMonth(ctx);
      if (listPeople(ctx.db).length === 0 || !monthExists(ctx.db, month)) return;
      const dash = buildDashboard(ctx, month);
      const balance = buildBalance(ctx.db, month);
      const names = new Map(listPeople(ctx.db).map((p) => [p.id, p.name]));
      const debt = balance.overallBalance.debt;
      const categories = dash.groups.flatMap((g) => g.categories);
      // Imprévus has no budget by design, so it would always look "over": it is reported on its own.
      const over = categories.filter((c) => c.status === 'over' && !c.isSystem);
      const spentPercent = dash.totals.effective > 0 ? Math.round((dash.totals.spent / dash.totals.effective) * 1000) / 10 : 0;
      const base = { month, icon: 'mdi:wallet' };

      await Promise.all([
        client.setState('sensor.budget_remaining', eur(dash.totals.remaining), {
          ...base,
          friendly_name: 'Budget restant',
          unit_of_measurement: '€',
          device_class: 'monetary',
          spent: eur(dash.totals.spent),
          budget: eur(dash.totals.effective),
          projected: eur(dash.totals.projected),
        }),
        client.setState('sensor.budget_spent', eur(dash.totals.spent), {
          ...base,
          friendly_name: 'Dépenses du mois',
          unit_of_measurement: '€',
          device_class: 'monetary',
        }),
        client.setState('sensor.budget_balance_owed', debt ? eur(debt.amountCents) : 0, {
          ...base,
          friendly_name: 'Solde à rembourser',
          unit_of_measurement: '€',
          device_class: 'monetary',
          icon: 'mdi:scale-balance',
          debtor: debt ? names.get(debt.debtorId) : null,
          creditor: debt ? names.get(debt.creditorId) : null,
          summary: debt
            ? `${names.get(debt.debtorId)} doit ${formatEur(debt.amountCents)} à ${names.get(debt.creditorId)}`
            : 'À jour',
        }),
        client.setState('sensor.budget_spent_percent', spentPercent, {
          ...base,
          friendly_name: 'Budget consommé',
          unit_of_measurement: '%',
          icon: 'mdi:gauge',
        }),
        client.setState('sensor.budget_projected', eur(dash.totals.projected), {
          ...base,
          friendly_name: 'Projection de fin de mois',
          unit_of_measurement: '€',
          device_class: 'monetary',
          icon: 'mdi:chart-line',
          budget: eur(dash.totals.effective),
        }),
        client.setState('sensor.budget_over_budget_categories', over.length, {
          ...base,
          friendly_name: 'Catégories dépassées',
          icon: 'mdi:alert-circle-outline',
          categories: over.map((c) => c.name),
          imprevus_to_reclassify: dash.imprevusCount,
        }),
        client.setState('sensor.budget_savings_rate', dash.totals.savingsRate === null ? 'unknown' : Math.round(dash.totals.savingsRate * 1000) / 10, {
          ...base,
          friendly_name: "Taux d'épargne",
          unit_of_measurement: '%',
          icon: 'mdi:piggy-bank',
        }),
        client.setState('sensor.budget_pending_expenses', dash.pendingCount, {
          ...base,
          friendly_name: 'Dépenses à confirmer',
          icon: 'mdi:clipboard-check-outline',
        }),
      ]);
    } catch (err) {
      opts.onError?.(err);
    }
  };

  return {
    publishNow,
    schedule() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void publishNow();
      }, delay);
      timer.unref();
    },
  };
}
