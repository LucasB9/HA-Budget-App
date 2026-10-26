import { Link } from 'react-router-dom';
import { formatMonthFr } from '@budget/shared';
import { EmptyState, ErrorBox, Loading, Money } from '../components/ui';
import { useApp } from '../lib/app-context';
import { useTagSummary } from '../lib/queries';

/** Totals per tag across categories and months. An expense with several tags counts once per tag. */
export function Tags(): JSX.Element {
  const { categoryName } = useApp();
  const summary = useTagSummary();
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Par tag</h1>
      </div>
      {summary.isLoading ? <Loading /> : null}
      {summary.error ? <ErrorBox error={summary.error} /> : null}
      {summary.data && summary.data.length === 0 ? (
        <EmptyState>Aucun tag pour l'instant. Ajoute-en à une dépense (vacances, cadeau, déménagement…).</EmptyState>
      ) : null}
      {(summary.data ?? []).map((row) => {
        const byCategory = Object.entries(row.byCategory).sort((a, b) => b[1] - a[1]);
        const byMonth = Object.entries(row.byMonth).sort((a, b) => (a[0] < b[0] ? 1 : -1));
        return (
          <div key={row.tag} className="card stack">
            <div className="spread">
              <Link to={`/depenses?m=all&tag=${encodeURIComponent(row.tag)}`} style={{ fontWeight: 600, fontSize: 18 }}>
                #{row.tag}
              </Link>
              <div className="row-right">
                <Money cents={row.totalCents} />
                <div className="row-sub">
                  {row.count} dépense{row.count > 1 ? 's' : ''}
                </div>
              </div>
            </div>
            <div className="stack-sm">
              <span className="card-title">Par catégorie</span>
              {byCategory.map(([categoryId, cents]) => (
                <div key={categoryId} className="spread small">
                  <span>{categoryName(categoryId)}</span>
                  <Money cents={cents} />
                </div>
              ))}
            </div>
            <div className="stack-sm">
              <span className="card-title">Par mois</span>
              {byMonth.map(([month, cents]) => (
                <div key={month} className="spread small">
                  <span style={{ textTransform: 'capitalize' }}>{formatMonthFr(month)}</span>
                  <Money cents={cents} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
