import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatEur, formatPercent, type DashboardCategory, type DashboardGroup } from '@budget/shared';
import { CategorySheet } from '../components/CategorySheet';
import { TransferSheet } from '../components/TransferSheet';
import { ErrorBox, Loading, Money, MonthSwitcher, Progress } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useMonthParam } from '../lib/format';
import { useAction, useDashboard, useMonthDto } from '../lib/queries';

const KIND_BADGE = { fixed: 'Fixe', provision: 'Provision', variable: '', system: '' } as const;

function GroupCard({ group, onOpen }: { group: DashboardGroup; onOpen: (c: DashboardCategory) => void }): JSX.Element {
  return (
    <section className="stack-sm">
      <div className="spread section-title">
        <span>{group.name}</span>
        <span className="num">
          {formatEur(group.spent, { compact: true })} / {formatEur(group.effective, { compact: true })}
        </span>
      </div>
      <div className="card card-flush list">
        {group.categories.map((c) => (
          <button key={c.categoryId} className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }} onClick={() => onOpen(c)}>
            <div className="spread">
              <div className="row-main">
                <div className="row-title-wrap">
                  {c.name}
                  {KIND_BADGE[c.kind] ? <span className="badge">{KIND_BADGE[c.kind]}</span> : null}
                  {c.isSystem && c.expenseCount > 0 ? <span className="badge badge-warn">{c.expenseCount} à reclasser</span> : null}
                  {c.pendingCount > 0 ? <span className="badge badge-warn">à confirmer</span> : null}
                </div>
                <div className="row-sub num">
                  {formatEur(c.spent, { compact: true })} sur {formatEur(c.effective, { compact: true })}
                </div>
              </div>
              <div className="row-right">
                <Money cents={c.remaining} compact className={c.status === 'over' ? 'bad' : c.status === 'warn' ? 'warn' : ''} />
                <div className="row-sub">restant</div>
              </div>
            </div>
            {!c.isSystem || c.effective > 0 ? <Progress ratio={c.ratio} status={c.status} /> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

export function Home(): JSX.Element {
  const [month, setMonth] = useMonthParam();
  const dash = useDashboard(month);
  const monthDto = useMonthDto(month);
  const [open, setOpen] = useState<DashboardCategory | null>(null);
  const [transfer, setTransfer] = useState<{ from?: string } | null>(null);

  const createMonth = useAction(() => api.post(`/months/${month}`), { success: 'Mois créé' });

  const missing = dash.error instanceof ApiError && dash.error.code === 'month_not_found';
  const data = dash.data;

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Budget</h1>
        <MonthSwitcher month={month} onChange={setMonth} />
      </div>

      {dash.isLoading ? <Loading /> : null}
      {dash.error && !missing ? <ErrorBox error={dash.error} /> : null}

      {missing ? (
        <div className="card stack" style={{ textAlign: 'center' }}>
          <p>Ce mois n'est pas encore créé.</p>
          <p className="muted small">Il sera copié depuis le mois précédent (ou le modèle de budget).</p>
          <button className="btn btn-primary" disabled={createMonth.isPending} onClick={() => createMonth.mutate(undefined)}>
            Créer {month}
          </button>
        </div>
      ) : null}

      {data ? (
        <>
          <div className="card stack">
            <span className="card-title">Reste à dépenser</span>
            <div className={`kpi-hero num ${data.totals.remaining < 0 ? 'bad' : ''}`}>
              {formatEur(data.totals.remaining, { compact: true })}
            </div>
            <Progress
              ratio={data.totals.effective > 0 ? data.totals.spent / data.totals.effective : 0}
              status={data.totals.spent > data.totals.effective ? 'over' : data.totals.effective > 0 && data.totals.spent / data.totals.effective > 0.8 ? 'warn' : 'ok'}
            />
            <div className="spread small muted">
              <span>Dépensé {formatEur(data.totals.spent, { compact: true })}</span>
              <span>Budget {formatEur(data.totals.effective, { compact: true })}</span>
            </div>
            {data.position !== 'past' ? (
              <p className="small muted">
                Projection fin de mois :{' '}
                <strong className={data.totals.projected > data.totals.effective ? 'warn' : ''}>
                  {formatEur(data.totals.projected, { compact: true })}
                </strong>
              </p>
            ) : null}
          </div>

          <div className="kpis">
            <div className="card">
              <div className="kpi-label">Revenus</div>
              <div className="kpi-value num">{formatEur(data.totals.income, { compact: true })}</div>
            </div>
            <div className="card">
              <div className="kpi-label">À épargner (prévu)</div>
              <div className="kpi-value num">{formatEur(data.totals.plannedBalance, { compact: true })}</div>
            </div>
            <div className="card">
              <div className="kpi-label">Reste réel</div>
              <div className={`kpi-value num ${data.totals.actualBalance < 0 ? 'bad' : ''}`}>
                {formatEur(data.totals.actualBalance, { compact: true })}
              </div>
            </div>
            <div className="card">
              <div className="kpi-label">Épargné</div>
              <div className="kpi-value num">{formatEur(data.totals.savingsContributions, { compact: true })}</div>
              {data.totals.savingsRate !== null ? (
                <div className="kpi-label">{formatPercent(data.totals.savingsRate)} des revenus</div>
              ) : null}
            </div>
          </div>

          {data.pendingCount > 0 ? (
            <Link className="banner" to={`/depenses?m=${month}&status=pending`}>
              {data.pendingCount} dépense{data.pendingCount > 1 ? 's' : ''} fixe{data.pendingCount > 1 ? 's' : ''} à confirmer ›
            </Link>
          ) : null}
          {data.imprevusCount > 0 ? (
            <Link className="banner" to={`/depenses?m=${month}&cat=${data.groups.flatMap((g) => g.categories).find((c) => c.isSystem)?.categoryId ?? ''}`}>
              {data.imprevusCount} dépense{data.imprevusCount > 1 ? 's' : ''} en Imprévus ({formatEur(data.imprevusCents)}) à reclasser ›
            </Link>
          ) : null}
          {monthDto.data?.ratioStale ? (
            <Link className="banner banner-info" to={`/revenus?m=${month}`}>
              Les revenus ont changé : le ratio de répartition de ce mois n'a pas été recalculé ›
            </Link>
          ) : null}

          {data.groups.map((g) => (
            <GroupCard key={g.groupId} group={g} onOpen={setOpen} />
          ))}
          {data.groups.length === 0 ? (
            <div className="card empty">
              Aucune catégorie. <Link to="/categories">Créer des catégories</Link>
            </div>
          ) : null}
        </>
      ) : null}

      {open ? (
        <CategorySheet
          cat={open}
          month={month}
          onClose={() => setOpen(null)}
          onTransfer={() => {
            setTransfer({ from: open.categoryId });
            setOpen(null);
          }}
        />
      ) : null}
      {transfer ? (
        <TransferSheet month={month} {...(transfer.from ? { fromCategoryId: transfer.from } : {})} onClose={() => setTransfer(null)} />
      ) : null}
    </div>
  );
}
