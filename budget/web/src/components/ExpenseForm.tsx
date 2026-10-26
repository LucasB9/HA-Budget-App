import { useMemo, useState } from 'react';
import {
  computeShares,
  formatEur,
  formatPercent,
  monthOfDate,
  type Cents,
  type ExpenseDto,
  type ExpenseInput,
  type SplitMode,
} from '@budget/shared';
import { api } from '../lib/api';
import { useApp } from '../lib/app-context';
import { readRecentCategories, rememberCategory } from '../lib/format';
import { useAction, useMonthDto, useTags } from '../lib/queries';
import { ConfirmSheet, Field, MoneyInput, Segmented } from './ui';

const SPLIT_OPTIONS: { value: SplitMode; label: string }[] = [
  { value: 'income', label: 'Revenus' },
  { value: 'equal', label: '50/50' },
  { value: 'single', label: '100 %' },
  { value: 'custom', label: 'Perso' },
];

function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }): JSX.Element {
  const [draft, setDraft] = useState('');
  const known = useTags().data ?? [];
  const add = (raw: string): void => {
    const name = raw.trim().replace(/^#/, '');
    if (name && !tags.some((t) => t.toLowerCase() === name.toLowerCase())) onChange([...tags, name]);
    setDraft('');
  };
  return (
    <div className="stack-sm">
      {tags.length > 0 ? (
        <div className="chips">
          {tags.map((t) => (
            <button key={t} type="button" className="chip" aria-pressed="true" onClick={() => onChange(tags.filter((x) => x !== t))}>
              #{t} ✕
            </button>
          ))}
        </div>
      ) : null}
      <input
        className="input"
        list="known-tags"
        value={draft}
        placeholder="Ajouter un tag (vacances, cadeau…)"
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(',')) add(v.slice(0, -1));
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => add(draft)}
      />
      <datalist id="known-tags">
        {known.map((t) => (
          <option key={t.name} value={t.name} />
        ))}
      </datalist>
    </div>
  );
}

export function ExpenseForm({
  expense,
  initialCategoryId,
  onDone,
}: {
  expense?: ExpenseDto;
  initialCategoryId?: string;
  onDone: () => void;
}): JSX.Element {
  const { session, people, me, catalog, categoryLabel } = useApp();
  const [first, second] = people;
  const defaultSplit: SplitMode = session.settings.defaultSplitMode;

  const [amount, setAmount] = useState<Cents | null>(expense?.amountCents ?? null);
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? initialCategoryId ?? '');
  const [subcategoryId, setSubcategoryId] = useState<string | null>(expense?.subcategoryId ?? null);
  const [date, setDate] = useState(expense?.date ?? session.today);
  const [payerId, setPayerId] = useState(expense?.payerId ?? me?.id ?? first?.id ?? '');
  const [splitMode, setSplitMode] = useState<SplitMode>(expense?.splitMode ?? defaultSplit);
  const [singleId, setSingleId] = useState(expense?.singleId ?? payerId);
  const [customPct, setCustomPct] = useState(
    String(expense?.customBp && first ? (expense.customBp[first.id] ?? 5000) / 100 : 50),
  );
  const [tags, setTags] = useState<string[]>(expense?.tags ?? []);
  const [note, setNote] = useState(expense?.note ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selectedCategory = catalog.flatMap((g) => g.categories).find((c) => c.id === categoryId);
  const activeSubs = selectedCategory?.subcategories.filter((s) => !s.archived || s.id === subcategoryId) ?? [];

  const month = monthOfDate(date);
  const monthDto = useMonthDto(month);
  const fallbackDto = useMonthDto(session.currentMonth);
  const weights = (monthDto.data ?? fallbackDto.data)?.weights;

  const customBp = useMemo(() => {
    const pct = Math.min(100, Math.max(0, Number(customPct.replace(',', '.')) || 0));
    const bp = Math.round(pct * 100);
    return first && second ? { [first.id]: bp, [second.id]: 10000 - bp } : null;
  }, [customPct, first, second]);

  const preview = useMemo(() => {
    if (!amount || amount <= 0 || !first || !second || !payerId) return null;
    try {
      return computeShares({
        mode: splitMode,
        amountCents: amount,
        payerId,
        personIds: [first.id, second.id],
        ...(weights ? { incomeWeights: weights } : {}),
        ...(splitMode === 'single' ? { singleId } : {}),
        ...(splitMode === 'custom' && customBp ? { customBp } : {}),
      });
    } catch {
      return null;
    }
  }, [amount, splitMode, payerId, weights, singleId, customBp, first, second]);

  const save = useAction(
    (input: ExpenseInput) => (expense ? api.put(`/expenses/${expense.id}`, input) : api.post('/expenses', input)),
    {
      success: expense ? 'Dépense modifiée' : 'Dépense ajoutée',
      onSuccess: onDone,
    },
  );
  const remove = useAction(() => api.delete(`/expenses/${expense?.id ?? ''}`), {
    success: 'Dépense supprimée',
    onSuccess: onDone,
  });

  const recents = readRecentCategories().filter((r) =>
    catalog.some((g) => g.categories.some((c) => c.id === r.categoryId && !c.archived)),
  );

  const valid = amount !== null && amount > 0 && categoryId !== '' && payerId !== '';

  const submit = (): void => {
    if (!valid || amount === null) return;
    rememberCategory({ categoryId, subcategoryId });
    save.mutate({
      date,
      amountCents: amount,
      categoryId,
      subcategoryId,
      payerId,
      splitMode,
      singleId: splitMode === 'single' ? singleId : null,
      customBp: splitMode === 'custom' ? customBp : null,
      tags,
      note,
    });
  };

  return (
    <div className="stack">
      <div className="card stack">
        <MoneyInput
          className="input amount-input"
          value={amount}
          onChange={setAmount}
          autoFocus={!expense}
          ariaLabel="Montant en euros"
          placeholder="0,00 €"
        />
        {expense?.status === 'pending' ? (
          <div className="banner">Dépense fixe à confirmer : ajustez le montant réel puis enregistrez.</div>
        ) : null}
      </div>

      <div className="card stack">
        {recents.length > 0 && !expense ? (
          <div className="stack-sm">
            <span className="field-label">Récents</span>
            <div className="chips">
              {recents.map((r) => (
                <button
                  key={`${r.categoryId}-${r.subcategoryId ?? ''}`}
                  type="button"
                  className="chip"
                  aria-pressed={r.categoryId === categoryId && r.subcategoryId === subcategoryId}
                  onClick={() => {
                    setCategoryId(r.categoryId);
                    setSubcategoryId(r.subcategoryId);
                  }}
                >
                  {categoryLabel(r.categoryId, r.subcategoryId).split(' › ').pop()}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <Field label="Catégorie">
          <select
            className="select"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setSubcategoryId(null);
            }}
          >
            <option value="" disabled>
              Choisir…
            </option>
            {catalog
              .filter((g) => !g.archived || g.categories.some((c) => c.id === categoryId))
              .map((g) => (
                <optgroup key={g.id} label={g.name}>
                  {g.categories
                    .filter((c) => !c.archived || c.id === categoryId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.archived ? ' (archivée)' : ''}
                      </option>
                    ))}
                </optgroup>
              ))}
          </select>
        </Field>

        {activeSubs.length > 0 ? (
          <Field label="Sous-ligne">
            <select className="select" value={subcategoryId ?? ''} onChange={(e) => setSubcategoryId(e.target.value || null)}>
              <option value="">— Catégorie entière —</option>
              {activeSubs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="Date">
          <input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
      </div>

      <div className="card stack">
        <Field label="Payé par" group>
          <Segmented
            label="Payé par"
            value={payerId}
            onChange={setPayerId}
            options={people.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Field>

        <Field label="Répartition" group>
          <Segmented label="Répartition" value={splitMode} onChange={setSplitMode} options={SPLIT_OPTIONS} />
        </Field>

        {splitMode === 'single' ? (
          <Field label="Dépense de" group>
            <Segmented
              label="Dépense de"
              value={singleId}
              onChange={setSingleId}
              options={people.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Field>
        ) : null}

        {splitMode === 'custom' && first && second ? (
          <Field label={`Part de ${first.name} (%) — ${second.name} : ${(100 - (Number(customPct.replace(',', '.')) || 0)).toFixed(1).replace('.0', '')} %`}>
            <input className="input" inputMode="decimal" value={customPct} onChange={(e) => setCustomPct(e.target.value)} />
          </Field>
        ) : null}

        {preview && first && second ? (
          <p className="muted small num" aria-live="polite">
            {first.name} {formatEur(preview[first.id] ?? 0)} · {second.name} {formatEur(preview[second.id] ?? 0)}
            {splitMode === 'income' && weights ? ` (${formatPercent((preview[first.id] ?? 0) / (amount ?? 1))} / ${formatPercent((preview[second.id] ?? 0) / (amount ?? 1))})` : ''}
          </p>
        ) : null}
      </div>

      <div className="card stack">
        <Field label="Tags" group>
          <TagInput tags={tags} onChange={setTags} />
        </Field>
        <Field label="Note">
          <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. : plein + péage" />
        </Field>
      </div>

      <button className="btn btn-primary btn-block" disabled={!valid || save.isPending} onClick={submit}>
        {expense ? (expense.status === 'pending' ? 'Confirmer' : 'Enregistrer') : 'Ajouter'}
      </button>
      {expense ? (
        <button className="btn btn-danger btn-block" onClick={() => setConfirmDelete(true)}>
          Supprimer
        </button>
      ) : null}
      {confirmDelete ? (
        <ConfirmSheet
          title="Supprimer cette dépense ?"
          message="Cette action est définitive."
          confirmLabel="Supprimer"
          danger
          onConfirm={() => remove.mutate(undefined)}
          onClose={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}
