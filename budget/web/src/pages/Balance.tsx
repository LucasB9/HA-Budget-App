import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatEur, formatPercent, type BalanceSummary, type Cents } from '@budget/shared';
import { ConfirmSheet, EmptyState, ErrorBox, Field, Loading, Money, MoneyInput, MonthSwitcher, Segmented, Sheet } from '../components/ui';
import { api } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDayFr, useMonthParam } from '../lib/format';
import { useAction, useBalance } from '../lib/queries';

function DebtLine({ summary }: { summary: BalanceSummary }): JSX.Element {
  const { personName } = useApp();
  if (!summary.debt) {
    return <div className="kpi-value good">À jour ✓</div>;
  }
  return (
    <div>
      <div className="kpi-value num">{formatEur(summary.debt.amountCents)}</div>
      <div className="muted">
        {personName(summary.debt.debtorId)} doit à {personName(summary.debt.creditorId)}
      </div>
    </div>
  );
}

function SettleSheet({ defaultAmount, defaultFrom, onClose }: { defaultAmount: Cents; defaultFrom: string; onClose: () => void }): JSX.Element {
  const { session, people } = useApp();
  const [from, setFrom] = useState(defaultFrom || people[0]?.id || '');
  const to = people.find((p) => p.id !== from)?.id ?? '';
  const [amount, setAmount] = useState<Cents | null>(defaultAmount > 0 ? defaultAmount : null);
  const [date, setDate] = useState(session.today);
  const [note, setNote] = useState('');

  const save = useAction(
    () => api.post('/settlements', { date, fromId: from, toId: to, amountCents: amount, note }),
    { success: 'Remboursement enregistré', onSuccess: onClose },
  );
  const valid = amount !== null && amount > 0 && from !== '' && to !== '';

  return (
    <Sheet title="Enregistrer un remboursement" onClose={onClose}>
      <div className="stack">
        <Field label="Qui rembourse ?" group>
          <Segmented value={from} onChange={setFrom} options={people.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
        <Field label="Montant">
          <MoneyInput value={amount} onChange={setAmount} placeholder="0,00" />
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
        <Field label="Note (optionnel)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Virement, espèces…" />
        </Field>
        <button className="btn btn-primary btn-block" disabled={!valid || save.isPending} onClick={() => save.mutate(undefined)}>
          Enregistrer
        </button>
      </div>
    </Sheet>
  );
}

export function Balance(): JSX.Element {
  const { session, people, personName } = useApp();
  const [month, setMonth] = useMonthParam();
  const balance = useBalance(month);
  const [settling, setSettling] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const remove = useAction((id: string) => api.delete(`/settlements/${id}`), { success: 'Remboursement annulé' });
  const data = balance.data;
  const [first, second] = people;
  const overall = data?.overallBalance.debt ?? null;

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Solde</h1>
        <MonthSwitcher month={month} onChange={setMonth} />
      </div>

      {balance.isLoading ? <Loading /> : null}
      {balance.error ? <ErrorBox error={balance.error} /> : null}

      {data && first && second ? (
        <>
          {data.pendingCount > 0 ? (
            <Link className="banner" to={`/depenses?m=${month}&status=pending`}>
              {data.pendingCount} dépense{data.pendingCount > 1 ? 's' : ''} à confirmer ({formatEur(data.pendingCents)}) ne
              compte{data.pendingCount > 1 ? 'nt' : ''} pas encore dans le solde ›
            </Link>
          ) : null}
          <div className="card stack">
            <span className="card-title">Au total</span>
            <DebtLine summary={data.overallBalance} />
            <button className="btn btn-primary btn-block" onClick={() => setSettling(true)}>
              {overall ? 'Rembourser' : 'Enregistrer un remboursement'}
            </button>
          </div>

          <div className="card stack">
            <span className="card-title">Ce mois-ci</span>
            <DebtLine summary={data.monthBalance} />
            <p className="muted small">
              Ratio selon les revenus : {first.name} {formatPercent(data.ratio[first.id] ?? 0)} · {second.name}{' '}
              {formatPercent(data.ratio[second.id] ?? 0)}
            </p>
            <div className="list">
              {people.map((p) => (
                <div key={p.id} className="spread" style={{ padding: '10px 0' }}>
                  <span>{p.name}</span>
                  <span className="small muted num">
                    a payé <Money cents={data.monthPaid[p.id] ?? 0} /> · supporte <Money cents={data.monthShare[p.id] ?? 0} />
                  </span>
                </div>
              ))}
            </div>
          </div>

          <section className="stack-sm">
            <div className="section-title">Historique des remboursements</div>
            {data.settlements.length === 0 ? <EmptyState>Aucun remboursement enregistré.</EmptyState> : null}
            {data.settlements.length > 0 ? (
              <div className="card card-flush list">
                {data.settlements.map((s) => (
                  <div key={s.id} className="row row-static">
                    <div className="row-main">
                      <div className="row-title">
                        {personName(s.fromId)} → {personName(s.toId)}
                      </div>
                      <div className="row-sub">
                        {formatDayFr(s.date, session.today)}
                        {s.note ? ` · ${s.note}` : ''}
                      </div>
                    </div>
                    <div className="row-right">
                      <Money cents={s.amountCents} />
                      <div>
                        <button className="btn btn-sm btn-ghost bad" onClick={() => setToDelete(s.id)}>
                          Annuler
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {settling ? (
        <SettleSheet
          defaultAmount={overall?.amountCents ?? 0}
          defaultFrom={overall?.debtorId ?? ''}
          onClose={() => setSettling(false)}
        />
      ) : null}
      {toDelete ? (
        <ConfirmSheet
          title="Annuler ce remboursement ?"
          message="Le solde sera recalculé comme s'il n'avait pas eu lieu."
          confirmLabel="Annuler le remboursement"
          danger
          onConfirm={() => remove.mutate(toDelete)}
          onClose={() => setToDelete(null)}
        />
      ) : null}
    </div>
  );
}
