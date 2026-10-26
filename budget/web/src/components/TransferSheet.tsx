import { useState } from 'react';
import type { Cents } from '@budget/shared';
import { api } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useAction } from '../lib/queries';
import { Field, MoneyInput, Sheet } from './ui';

/** Moves budget from one envelope to another for a single month. */
export function TransferSheet({
  month,
  fromCategoryId = '',
  toCategoryId = '',
  onClose,
}: {
  month: string;
  fromCategoryId?: string;
  toCategoryId?: string;
  onClose: () => void;
}): JSX.Element {
  const { catalog } = useApp();
  const [from, setFrom] = useState(fromCategoryId);
  const [to, setTo] = useState(toCategoryId);
  const [amount, setAmount] = useState<Cents | null>(null);
  const [note, setNote] = useState('');

  const save = useAction(
    () => api.post(`/months/${month}/transfers`, { fromCategoryId: from, toCategoryId: to, amountCents: amount, note }),
    { success: 'Virement enregistré', onSuccess: onClose },
  );

  const options = (exclude: string): JSX.Element[] =>
    catalog
      .filter((g) => !g.archived)
      .map((g) => (
        <optgroup key={g.id} label={g.name}>
          {g.categories
            .filter((c) => !c.archived && c.id !== exclude)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </optgroup>
      ));

  const valid = from !== '' && to !== '' && from !== to && amount !== null && amount > 0;

  return (
    <Sheet title="Virement entre enveloppes" onClose={onClose}>
      <div className="stack">
        <p className="muted small">Ne change que ce mois-ci : le budget prévu des autres mois reste intact.</p>
        <Field label="Depuis">
          <select className="select" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="" disabled>
              Choisir…
            </option>
            {options(to)}
          </select>
        </Field>
        <Field label="Vers">
          <select className="select" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="" disabled>
              Choisir…
            </option>
            {options(from)}
          </select>
        </Field>
        <Field label="Montant">
          <MoneyInput value={amount} onChange={setAmount} placeholder="0,00" />
        </Field>
        <Field label="Note (optionnel)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={!valid || save.isPending} onClick={() => save.mutate(undefined)}>
          Virer
        </button>
      </div>
    </Sheet>
  );
}
