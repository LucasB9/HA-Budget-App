import { useEffect, useState } from 'react';
import { formatPercent, type Cents } from '@budget/shared';
import { TransferSheet } from '../components/TransferSheet';
import { ConfirmSheet, EmptyState, ErrorBox, Field, Loading, Money, MoneyInput, MonthSwitcher } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useMonthParam } from '../lib/format';
import { useAction, useMonthDto, useTransfers } from '../lib/queries';

interface IncomeDraft {
  amount: Cents | null;
  note: string;
}

export function Month(): JSX.Element {
  const { people, categoryName } = useApp();
  const [month, setMonth] = useMonthParam();
  const monthDto = useMonthDto(month);
  const transfers = useTransfers(month);
  const [drafts, setDrafts] = useState<Record<string, IncomeDraft>>({});
  const [confirmRecalc, setConfirmRecalc] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);

  useEffect(() => {
    if (!monthDto.data) return;
    setDrafts(Object.fromEntries(monthDto.data.incomes.map((i) => [i.personId, { amount: i.amountCents, note: i.note }])));
  }, [monthDto.data]);

  const saveIncomes = useAction(
    () =>
      api.put(`/months/${month}/incomes`, {
        incomes: people.map((p) => ({ personId: p.id, amountCents: drafts[p.id]?.amount ?? 0, note: drafts[p.id]?.note ?? '' })),
      }),
    { success: 'Revenus enregistrés' },
  );
  const recalc = useAction(() => api.post<{ updatedExpenses: number }>(`/months/${month}/recalculate`), {
    success: 'Ratio recalculé',
  });
  const removeTransfer = useAction((id: string) => api.delete(`/months/${month}/transfers/${id}`), { success: 'Virement supprimé' });
  const createMonth = useAction(() => api.post(`/months/${month}`), { success: 'Mois créé' });

  const missing = monthDto.error instanceof ApiError && monthDto.error.code === 'month_not_found';
  const dto = monthDto.data;
  const [first, second] = people;

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Revenus</h1>
        <MonthSwitcher month={month} onChange={setMonth} />
      </div>

      {monthDto.isLoading ? <Loading /> : null}
      {monthDto.error && !missing ? <ErrorBox error={monthDto.error} /> : null}
      {missing ? (
        <div className="card stack" style={{ textAlign: 'center' }}>
          <p>Ce mois n'est pas encore créé.</p>
          <button className="btn btn-primary" onClick={() => createMonth.mutate(undefined)}>
            Créer {month}
          </button>
        </div>
      ) : null}

      {dto && first && second ? (
        <>
          <div className="card stack">
            <span className="card-title">Revenus du mois</span>
            <p className="muted small">
              Saisis directement en euros chaque mois (le taux de change varie) ; la note sert de pense-bête.
            </p>
            {people.map((p) => (
              <div key={p.id} className="stack-sm">
                <Field label={p.name}>
                  <MoneyInput
                    value={drafts[p.id]?.amount ?? null}
                    onChange={(c) => setDrafts({ ...drafts, [p.id]: { amount: c, note: drafts[p.id]?.note ?? '' } })}
                  />
                </Field>
                <input
                  className="input"
                  placeholder="Note (ex. 6 800 CHF à 0,96)"
                  value={drafts[p.id]?.note ?? ''}
                  onChange={(e) => setDrafts({ ...drafts, [p.id]: { amount: drafts[p.id]?.amount ?? null, note: e.target.value } })}
                />
              </div>
            ))}
            <button className="btn btn-primary btn-block" disabled={saveIncomes.isPending} onClick={() => saveIncomes.mutate(undefined)}>
              Enregistrer les revenus
            </button>
          </div>

          <div className="card stack">
            <span className="card-title">Répartition « selon les revenus »</span>
            <div className="split-bar" aria-hidden="true">
              <span style={{ width: `${(dto.ratio[first.id] ?? 0.5) * 100}%` }} />
              <span style={{ width: `${(dto.ratio[second.id] ?? 0.5) * 100}%` }} />
            </div>
            <div className="spread">
              <span>
                {first.name} <strong className="num">{formatPercent(dto.ratio[first.id] ?? 0)}</strong>
              </span>
              <span>
                {second.name} <strong className="num">{formatPercent(dto.ratio[second.id] ?? 0)}</strong>
              </span>
            </div>
            <p className="muted small">
              Ce ratio est figé à la création du mois : modifier les revenus ne réécrit pas les soldes passés.
            </p>
            {dto.ratioStale ? (
              <>
                <div className="banner">Les revenus saisis ne correspondent plus au ratio figé de ce mois.</div>
                <button className="btn btn-block" disabled={recalc.isPending} onClick={() => setConfirmRecalc(true)}>
                  Recalculer ce mois
                </button>
              </>
            ) : null}
          </div>

          <div className="card stack">
            <div className="spread">
              <span className="card-title">Virements d'enveloppes</span>
              <button className="btn btn-sm" onClick={() => setShowTransfer(true)}>
                Nouveau
              </button>
            </div>
            {transfers.data && transfers.data.length === 0 ? <EmptyState>Aucun virement ce mois-ci.</EmptyState> : null}
            <div className="list">
              {(transfers.data ?? []).map((t) => (
                <div key={t.id} className="row row-static" style={{ padding: '10px 0' }}>
                  <div className="row-main">
                    <div className="row-title">
                      {categoryName(t.fromCategoryId)} → {categoryName(t.toCategoryId)}
                    </div>
                    {t.note ? <div className="row-sub">{t.note}</div> : null}
                  </div>
                  <div className="row-right">
                    <Money cents={t.amountCents} />
                    <div>
                      <button className="btn btn-sm btn-ghost bad" onClick={() => removeTransfer.mutate(t.id)}>
                        Annuler
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {confirmRecalc ? (
        <ConfirmSheet
          title="Recalculer ce mois ?"
          message="Le ratio du mois est recalculé à partir des revenus saisis, et la part de chaque dépense « selon les revenus » de ce mois est recalculée. Les soldes de ce mois changeront. Les autres répartitions (50/50, 100 %, perso) ne bougent pas."
          confirmLabel="Recalculer"
          onConfirm={() => recalc.mutate(undefined)}
          onClose={() => setConfirmRecalc(false)}
        />
      ) : null}
      {showTransfer ? <TransferSheet month={month} onClose={() => setShowTransfer(false)} /> : null}
    </div>
  );
}
