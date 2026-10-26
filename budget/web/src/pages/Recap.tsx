import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { addMonths, formatMonthFr, isMonthKey, type RecapDto } from '@budget/shared';
import { Markdown } from '../components/Markdown';
import { EmptyState, ErrorBox, Loading, MonthSwitcher, Sheet } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTimeFr } from '../lib/format';
import { useAction } from '../lib/queries';

function RecapCard({ recap }: { recap: RecapDto }): JSX.Element {
  return (
    <div className="card stack">
      <div className="spread">
        <span className="card-title" style={{ textTransform: 'capitalize' }}>
          {formatMonthFr(recap.month)}
        </span>
        <span className={`badge ${recap.trigger === 'auto' ? 'badge-accent' : ''}`}>{recap.trigger === 'auto' ? 'Automatique' : 'Manuel'}</span>
      </div>
      <Markdown source={recap.content} />
      <div className="muted small">
        {formatDateTimeFr(recap.createdAt)} · {recap.model}
        {recap.inputTokens !== null && recap.outputTokens !== null ? ` · ${recap.inputTokens + recap.outputTokens} jetons` : ''}
      </div>
    </div>
  );
}

function PreviewSheet({ month, onClose }: { month: string; onClose: () => void }): JSX.Element {
  const preview = useQuery({ queryKey: ['recap-preview', month], queryFn: () => api.get<unknown>(`/recaps/preview?month=${month}`) });
  return (
    <Sheet title="Données envoyées à l'IA" onClose={onClose}>
      <div className="stack">
        <p className="muted small">
          Seules ces données agrégées sont transmises à Anthropic : budget et dépenses par catégorie, dépenses notables avec leurs notes
          et tags, épargne et équilibre entre vous deux. Aucun identifiant, numéro de compte ou coordonnée bancaire.
        </p>
        {preview.isLoading ? <Loading /> : null}
        {preview.error ? <ErrorBox error={preview.error} /> : null}
        {preview.data ? (
          <pre className="card small" style={{ overflow: 'auto', maxHeight: '50dvh', margin: 0, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(preview.data, null, 2)}
          </pre>
        ) : null}
      </div>
    </Sheet>
  );
}

export function Recap(): JSX.Element {
  const { session } = useApp();
  const [params, setParams] = useSearchParams();
  const raw = params.get('m');
  // The recap that matters is usually the month that just ended.
  const month = raw && isMonthKey(raw) ? raw : addMonths(session.currentMonth, -1);
  const change = (next: string): void => setParams({ m: next }, { replace: true });
  const [showPreview, setShowPreview] = useState(false);

  const recaps = useQuery({ queryKey: ['recaps', month], queryFn: () => api.get<RecapDto[]>(`/recaps?month=${month}`) });
  const history = useQuery({ queryKey: ['recaps', 'all'], queryFn: () => api.get<RecapDto[]>('/recaps') });

  const generate = useAction(() => api.post<RecapDto>('/recaps', { month }), { success: 'Récap généré' });
  const monthMissing = generate.error instanceof ApiError && generate.error.code === 'month_not_found';

  const others = (history.data ?? []).filter((r) => r.month !== month);

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Récap</h1>
        <MonthSwitcher month={month} onChange={change} />
      </div>

      {!session.aiConfigured ? (
        <div className="banner">
          Aucune clé API Anthropic configurée. Ajoutez-la dans Paramètres › Apps › Budget › Configuration (option « anthropic_api_key »).
        </div>
      ) : null}

      <div className="card stack">
        <p className="muted small">
          Une analyse en français du mois : ce qui a bien marché, les dépassements et leurs causes (d'après vos notes), les dépenses
          inhabituelles, des suggestions chiffrées, l'épargne et l'équilibre entre vous deux.
        </p>
        <button className="btn btn-primary btn-block" disabled={!session.aiConfigured || generate.isPending} onClick={() => generate.mutate(undefined)}>
          {generate.isPending ? 'Génération en cours… (30 s environ)' : 'Générer le récap'}
        </button>
        <button className="btn btn-ghost btn-block" onClick={() => setShowPreview(true)}>
          Voir les données envoyées
        </button>
        {generate.error && !monthMissing ? <div className="banner banner-bad">{generate.error.message}</div> : null}
        {monthMissing ? <div className="banner">Ce mois n'existe pas encore : créez-le depuis l'écran Budget.</div> : null}
      </div>

      {recaps.isLoading ? <Loading /> : null}
      {recaps.error ? <ErrorBox error={recaps.error} /> : null}
      {recaps.data && recaps.data.length === 0 ? <EmptyState>Pas encore de récap pour ce mois.</EmptyState> : null}
      {(recaps.data ?? []).map((r) => (
        <RecapCard key={r.id} recap={r} />
      ))}

      {others.length > 0 ? (
        <section className="stack-sm">
          <div className="section-title">Historique</div>
          {others.map((r) => (
            <details key={r.id} className="card">
              <summary style={{ cursor: 'pointer', fontWeight: 600, textTransform: 'capitalize' }}>
                {formatMonthFr(r.month)} <span className="muted small">· {formatDateTimeFr(r.createdAt)}</span>
              </summary>
              <div style={{ marginTop: 12 }}>
                <Markdown source={r.content} />
              </div>
            </details>
          ))}
        </section>
      ) : null}

      {showPreview ? <PreviewSheet month={month} onClose={() => setShowPreview(false)} /> : null}
    </div>
  );
}
