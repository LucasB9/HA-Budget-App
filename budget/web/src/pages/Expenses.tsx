import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addMonths, isMonthKey, type ExpenseDto } from '@budget/shared';
import { ExpenseForm } from '../components/ExpenseForm';
import { EmptyState, ErrorBox, Loading, Money, Segmented, Sheet } from '../components/ui';
import { api } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDayFr } from '../lib/format';
import { useAction, useExpenses, useTags, type ExpenseFiltersState } from '../lib/queries';

const SPLIT_LABEL = { income: '', equal: '50/50', single: '100 %', custom: 'Perso' } as const;

function ExpenseRow({ e, onOpen }: { e: ExpenseDto; onOpen: () => void }): JSX.Element {
  const { personName, categoryName } = useApp();
  const confirm = useAction(() => api.post(`/expenses/${e.id}/confirm`), { success: 'Dépense confirmée' });
  const splitLabel = SPLIT_LABEL[e.splitMode];
  return (
    <div className="row" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(ev) => ev.key === 'Enter' && onOpen()}>
      <div className="row-main">
        <div className="row-title">{categoryName(e.categoryId, e.subcategoryId)}</div>
        <div className="row-sub">
          {personName(e.payerId)}
          {splitLabel ? ` · ${splitLabel}` : ''}
          {e.note ? ` · ${e.note}` : ''}
        </div>
        {e.tags.length > 0 || e.status === 'pending' ? (
          <div className="chips" style={{ marginTop: 4 }}>
            {e.status === 'pending' ? <span className="badge badge-warn">à confirmer</span> : null}
            {e.tags.map((t) => (
              <span key={t} className="badge badge-accent">
                #{t}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="row-right">
        <Money cents={e.amountCents} />
        {e.status === 'pending' ? (
          <div>
            <button
              className="btn btn-sm"
              style={{ marginTop: 4 }}
              disabled={confirm.isPending}
              onClick={(ev) => {
                ev.stopPropagation();
                confirm.mutate(undefined);
              }}
            >
              Confirmer
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Expenses(): JSX.Element {
  const { session, people, catalog } = useApp();
  const [params, setParams] = useSearchParams();
  const rawMonth = params.get('m');
  const allMonths = rawMonth === 'all';
  const month = rawMonth && isMonthKey(rawMonth) ? rawMonth : session.currentMonth;

  const filters: ExpenseFiltersState = {
    ...(allMonths ? {} : { month }),
    ...(params.get('cat') ? { categoryId: params.get('cat') as string } : {}),
    ...(params.get('tag') ? { tag: params.get('tag') as string } : {}),
    ...(params.get('p') ? { personId: params.get('p') as string } : {}),
    ...(params.get('q') ? { q: params.get('q') as string } : {}),
    ...(params.get('status') === 'pending' ? { status: 'pending' as const } : {}),
  };
  const set = (key: string, value: string | null): void =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );

  const expenses = useExpenses(filters);
  const tags = useTags().data ?? [];
  const [editing, setEditing] = useState<ExpenseDto | null>(null);
  const [searchDraft, setSearchDraft] = useState(params.get('q') ?? '');

  const groups = useMemo(() => {
    const byDate = new Map<string, ExpenseDto[]>();
    for (const e of expenses.data ?? []) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
    return [...byDate.entries()];
  }, [expenses.data]);
  const total = (expenses.data ?? []).reduce((s, e) => s + e.amountCents, 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Dépenses</h1>
        <div className="month-switch">
          <button className="icon-btn" aria-label="Mois précédent" disabled={allMonths} onClick={() => set('m', addMonths(month, -1))}>
            ‹
          </button>
          <button className="chip" aria-pressed={allMonths} onClick={() => set('m', allMonths ? month : 'all')}>
            {allMonths ? 'Tous les mois' : month}
          </button>
          <button className="icon-btn" aria-label="Mois suivant" disabled={allMonths} onClick={() => set('m', addMonths(month, 1))}>
            ›
          </button>
        </div>
      </div>

      <div className="card stack">
        <input
          className="input"
          type="search"
          placeholder="Rechercher (note, catégorie, tag)"
          value={searchDraft}
          onChange={(e) => {
            setSearchDraft(e.target.value);
            set('q', e.target.value.trim() || null);
          }}
        />
        <div className="hstack">
          <select className="select" aria-label="Catégorie" value={params.get('cat') ?? ''} onChange={(e) => set('cat', e.target.value || null)}>
            <option value="">Toutes catégories</option>
            {catalog.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select className="select" aria-label="Tag" value={params.get('tag') ?? ''} onChange={(e) => set('tag', e.target.value || null)}>
            <option value="">Tous tags</option>
            {tags.map((t) => (
              <option key={t.name} value={t.name}>
                #{t.name}
              </option>
            ))}
          </select>
        </div>
        <Segmented
          label="Payeur"
          value={params.get('p') ?? ''}
          onChange={(v) => set('p', v || null)}
          options={[{ value: '', label: 'Tous' }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
        />
        <div className="hstack">
          <button className="chip" aria-pressed={params.get('status') === 'pending'} onClick={() => set('status', params.get('status') === 'pending' ? null : 'pending')}>
            À confirmer
          </button>
          <span className="grow" />
          <span className="muted small num">
            {(expenses.data ?? []).length} dépense{(expenses.data ?? []).length > 1 ? 's' : ''} · <Money cents={total} />
          </span>
        </div>
      </div>

      {expenses.isLoading ? <Loading /> : null}
      {expenses.error ? <ErrorBox error={expenses.error} /> : null}
      {expenses.data && groups.length === 0 ? <EmptyState>Aucune dépense pour ces filtres.</EmptyState> : null}

      {groups.map(([date, items]) => (
        <section key={date} className="stack-sm">
          <div className="section-title">{formatDayFr(date, session.today)}</div>
          <div className="card card-flush list">
            {items.map((e) => (
              <ExpenseRow key={e.id} e={e} onOpen={() => setEditing(e)} />
            ))}
          </div>
        </section>
      ))}

      {editing ? (
        <Sheet title="Modifier la dépense" onClose={() => setEditing(null)}>
          <ExpenseForm expense={editing} onDone={() => setEditing(null)} />
        </Sheet>
      ) : null}
    </div>
  );
}
