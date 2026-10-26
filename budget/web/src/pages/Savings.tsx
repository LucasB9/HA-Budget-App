import { useState } from 'react';
import {
  formatEur,
  formatMonthFr,
  formatPercent,
  type Cents,
  type SavingsAccountDto,
  type SavingsEntryDto,
  type SavingsOverviewDto,
} from '@budget/shared';
import { Legend, LineChart, type ChartSeries } from '../components/LineChart';
import { EmptyState, ErrorBox, Field, Loading, Money, MoneyInput, MonthSwitcher, Progress, Sheet } from '../components/ui';
import { api } from '../lib/api';
import { useMonthParam } from '../lib/format';
import { useAction, useSavings } from '../lib/queries';

const COLORS = ['var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)'];

// ------------------------------------------------------------------ month entry

function EntrySheet({ account, month, entry, onClose }: { account: SavingsAccountDto; month: string; entry: SavingsEntryDto | undefined; onClose: () => void }): JSX.Element {
  const [contribution, setContribution] = useState<Cents | null>(entry?.contributionCents ?? null);
  const [balance, setBalance] = useState<Cents | null>(entry?.balanceCents ?? null);
  const [note, setNote] = useState(entry?.note ?? '');
  const save = useAction(
    () => api.put('/savings/entries', { accountId: account.id, month, contributionCents: contribution ?? 0, balanceCents: balance, note }),
    { success: 'Épargne enregistrée', onSuccess: onClose },
  );
  return (
    <Sheet title={`${account.name} · ${formatMonthFr(month)}`} onClose={onClose}>
      <div className="stack">
        <Field label="Versement du mois (négatif = retrait)">
          <MoneyInput value={contribution} onChange={setContribution} placeholder="0,00" autoFocus />
        </Field>
        <Field label="Solde de fin de mois (optionnel)" hint="Sert à suivre la valeur réelle du compte (plus-values incluses).">
          <MoneyInput value={balance} onChange={setBalance} placeholder="—" />
        </Field>
        <Field label="Note (optionnel)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={save.isPending} onClick={() => save.mutate(undefined)}>
          Enregistrer
        </button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ account

function AccountSheet({ account, onClose }: { account: SavingsAccountDto | null; onClose: () => void }): JSX.Element {
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState(account?.kind ?? '');
  const [goal, setGoal] = useState<Cents | null>(account?.goalCents ?? null);
  const [goalDate, setGoalDate] = useState(account?.goalDate ?? '');

  const save = useAction(
    () => {
      const body = { name, kind, goalCents: goal, goalDate: goal && goalDate ? goalDate : null };
      return account ? api.patch(`/savings/accounts/${account.id}`, body) : api.post('/savings/accounts', body);
    },
    { success: account ? 'Compte enregistré' : 'Compte créé', onSuccess: onClose },
  );
  const archive = useAction(() => api.patch(`/savings/accounts/${account?.id ?? ''}`, { archived: !account?.archived }), { onSuccess: onClose });

  return (
    <Sheet title={account ? account.name : 'Nouveau compte'} onClose={onClose}>
      <div className="stack">
        <Field label="Nom">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Type (PEA, livret, assurance-vie, CTO, crypto…)">
          <input className="input" value={kind} onChange={(e) => setKind(e.target.value)} list="account-kinds" />
          <datalist id="account-kinds">
            {['Livret', 'PEA', 'Assurance-vie', 'CTO', 'Crypto'].map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </Field>
        <Field label="Objectif (optionnel)">
          <MoneyInput value={goal} onChange={setGoal} placeholder="—" />
        </Field>
        {goal ? (
          <Field label="Date cible (optionnel)">
            <input className="input" type="date" value={goalDate} onChange={(e) => setGoalDate(e.target.value)} />
          </Field>
        ) : null}
        <button className="btn btn-primary btn-block" disabled={!name.trim() || save.isPending} onClick={() => save.mutate(undefined)}>
          Enregistrer
        </button>
        {account ? (
          <button className="btn btn-danger btn-block" onClick={() => archive.mutate(undefined)}>
            {account.archived ? 'Restaurer' : 'Archiver (l’historique est conservé)'}
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}

function GoalSheet({ onClose, goalCents, goalDate }: { onClose: () => void; goalCents: Cents | null; goalDate: string | null }): JSX.Element {
  const [target, setTarget] = useState<Cents | null>(goalCents);
  const [date, setDate] = useState(goalDate ?? '');
  const save = useAction(
    () => api.patch('/settings', { savingsGoalCents: target, savingsGoalDate: target && date ? date : null }),
    { success: 'Objectif enregistré', onSuccess: onClose },
  );
  return (
    <Sheet title="Objectif d'épargne global" onClose={onClose}>
      <div className="stack">
        <Field label="Montant cible (vide pour supprimer)">
          <MoneyInput value={target} onChange={setTarget} placeholder="—" autoFocus />
        </Field>
        {target ? (
          <Field label="Date cible (optionnel)">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        ) : null}
        <button className="btn btn-primary btn-block" disabled={save.isPending} onClick={() => save.mutate(undefined)}>
          Enregistrer
        </button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ page

function monthEntries(data: SavingsOverviewDto, month: string): Map<string, SavingsEntryDto> {
  return new Map(data.entries.filter((e) => e.month === month).map((e) => [e.accountId, e]));
}

export function Savings(): JSX.Element {
  const [month, setMonth] = useMonthParam();
  const savings = useSavings();
  const [entryFor, setEntryFor] = useState<SavingsAccountDto | null>(null);
  const [accountSheet, setAccountSheet] = useState<{ account: SavingsAccountDto | null } | null>(null);
  const [goalSheet, setGoalSheet] = useState(false);
  const data = savings.data;

  const active = (data?.accounts ?? []).filter((a) => !a.archived);
  const archived = (data?.accounts ?? []).filter((a) => a.archived);
  const entries = data ? monthEntries(data, month) : new Map<string, SavingsEntryDto>();
  const stat = data?.monthStats.find((s) => s.month === month);

  const chartSeries: ChartSeries[] = data
    ? [
        { name: 'Total versé', color: 'var(--c1)', bold: true, values: data.series.map((p) => p.cumulativeCents) },
        ...(data.series.some((p) => p.balanceCents !== null)
          ? [{ name: 'Valeur (soldes)', color: 'var(--text)', dashed: true, values: data.series.map((p) => p.balanceCents) }]
          : []),
        ...active.map((a, i) => ({
          name: a.name,
          color: COLORS[i % COLORS.length] as string,
          values: data.series.map((p) => p.perAccount[a.id] ?? 0),
        })),
      ]
    : [];

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Épargne</h1>
        <MonthSwitcher month={month} onChange={setMonth} />
      </div>

      {savings.isLoading ? <Loading /> : null}
      {savings.error ? <ErrorBox error={savings.error} /> : null}

      {data ? (
        <>
          <div className="card stack">
            <span className="card-title">Ce mois-ci</span>
            <div className="kpi-hero num">{formatEur(stat?.contributionCents ?? 0, { compact: true })}</div>
            <div className="spread small muted">
              <span>
                Taux d'épargne : <strong>{stat?.rate != null ? formatPercent(stat.rate) : '—'}</strong>
              </span>
              <span>Prévu : {stat?.plannedCents != null ? formatEur(stat.plannedCents, { compact: true }) : '—'}</span>
            </div>
            {stat?.plannedCents != null && stat.plannedCents > 0 ? (
              <Progress ratio={(stat.contributionCents) / stat.plannedCents} status="ok" />
            ) : null}
            <p className="muted small">« Prévu » = revenus − budget planifié du mois, ce que le budget laisse à mettre de côté.</p>
          </div>

          <section className="stack-sm">
            <div className="section-title">Versements de {formatMonthFr(month)}</div>
            {active.length === 0 ? <EmptyState>Aucun compte. Ajoutez un PEA, un livret…</EmptyState> : null}
            {active.length > 0 ? (
              <div className="card card-flush list">
                {active.map((a) => {
                  const e = entries.get(a.id);
                  return (
                    <button key={a.id} className="row" onClick={() => setEntryFor(a)}>
                      <div className="row-main">
                        <div className="row-title">{a.name}</div>
                        <div className="row-sub">
                          {e?.balanceCents != null ? `Solde ${formatEur(e.balanceCents)}` : a.kind || 'Saisir le versement'}
                        </div>
                      </div>
                      <div className="row-right">
                        <Money cents={e?.contributionCents ?? 0} className={e ? '' : 'muted'} signed />
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </section>

          {data.series.length > 0 && active.length > 0 ? (
            <div className="card stack">
              <span className="card-title">Évolution</span>
              <LineChart labels={data.series.map((p) => p.month)} series={chartSeries} />
              <Legend series={chartSeries} />
            </div>
          ) : null}

          <section className="stack-sm">
            <div className="spread section-title">
              <span>Comptes et objectifs</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setAccountSheet({ account: null })}>
                + Compte
              </button>
            </div>
            <div className="card card-flush list">
              {active.map((a) => (
                <button key={a.id} className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }} onClick={() => setAccountSheet({ account: a })}>
                  <div className="spread">
                    <div className="row-main">
                      <div className="row-title">{a.name}</div>
                      <div className="row-sub">
                        {a.kind ? `${a.kind} · ` : ''}versé {formatEur(a.contributionsCents, { compact: true })}
                        {a.latestBalanceCents !== null ? ` · solde ${formatEur(a.latestBalanceCents, { compact: true })}` : ''}
                      </div>
                    </div>
                    <div className="row-right">
                      <Money cents={a.currentCents} compact />
                      {a.goalCents ? <div className="row-sub">sur {formatEur(a.goalCents, { compact: true })}</div> : null}
                    </div>
                  </div>
                  {a.progress !== null ? (
                    <>
                      <Progress ratio={a.progress} status="ok" />
                      <div className="row-sub">
                        {formatPercent(a.progress, 0)}
                        {a.goalDate ? ` · avant le ${new Date(`${a.goalDate}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}` : ''}
                      </div>
                    </>
                  ) : null}
                </button>
              ))}
              {archived.map((a) => (
                <button key={a.id} className="row" style={{ opacity: 0.55 }} onClick={() => setAccountSheet({ account: a })}>
                  <div className="row-main">
                    <div className="row-title">{a.name} (archivé)</div>
                  </div>
                  <Money cents={a.currentCents} compact />
                </button>
              ))}
            </div>
          </section>

          <div className="card stack">
            <div className="spread">
              <span className="card-title">Objectif global</span>
              <button className="btn btn-sm" onClick={() => setGoalSheet(true)}>
                {data.goal ? 'Modifier' : 'Définir'}
              </button>
            </div>
            {data.goal ? (
              <>
                <div className="spread">
                  <span className="kpi-value num">{formatEur(data.goal.currentCents, { compact: true })}</span>
                  <span className="muted num">sur {formatEur(data.goal.targetCents, { compact: true })}</span>
                </div>
                <Progress ratio={data.goal.progress} status="ok" />
                <span className="muted small">
                  {formatPercent(data.goal.progress, 0)}
                  {data.goal.date ? ` · avant le ${new Date(`${data.goal.date}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}` : ''}
                </span>
              </>
            ) : (
              <span className="muted small">Aucun objectif global défini.</span>
            )}
          </div>

          {data.monthStats.length > 0 ? (
            <section className="stack-sm">
              <div className="section-title">Taux d'épargne par mois</div>
              <div className="card card-flush list">
                {[...data.monthStats].reverse().map((s) => (
                  <div key={s.month} className="row row-static">
                    <div className="row-main">
                      <div className="row-title" style={{ textTransform: 'capitalize' }}>
                        {formatMonthFr(s.month)}
                      </div>
                      <div className="row-sub">{s.plannedCents != null ? `prévu ${formatEur(s.plannedCents, { compact: true })}` : 'sans budget'}</div>
                    </div>
                    <div className="row-right">
                      <Money cents={s.contributionCents} compact />
                      <div className="row-sub">{s.rate != null ? formatPercent(s.rate) : '—'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {entryFor ? <EntrySheet account={entryFor} month={month} entry={entries.get(entryFor.id)} onClose={() => setEntryFor(null)} /> : null}
      {accountSheet ? <AccountSheet account={accountSheet.account} onClose={() => setAccountSheet(null)} /> : null}
      {goalSheet ? <GoalSheet goalCents={data?.goal?.targetCents ?? null} goalDate={data?.goal?.date ?? null} onClose={() => setGoalSheet(false)} /> : null}
    </div>
  );
}
