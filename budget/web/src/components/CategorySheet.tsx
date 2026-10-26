import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Cents, DashboardCategory } from '@budget/shared';
import { api } from '../lib/api';
import { useAction } from '../lib/queries';
import { Money, MoneyInput, Progress, Sheet } from './ui';

const KIND_LABEL = { fixed: 'Fixe', variable: 'Variable', provision: 'Provision', system: 'Imprévus' } as const;

function Line({ label, children, strong = false }: { label: string; children: JSX.Element; strong?: boolean }): JSX.Element {
  return (
    <div className="spread" style={strong ? { fontWeight: 600 } : undefined}>
      <span className={strong ? '' : 'muted'}>{label}</span>
      {children}
    </div>
  );
}

interface EditableLine {
  key: string;
  label: string;
  subcategoryId: string | null;
  planned: Cents | null;
}

export function CategorySheet({
  cat,
  month,
  onClose,
  onTransfer,
}: {
  cat: DashboardCategory;
  month: string;
  onClose: () => void;
  onTransfer: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [applyToTemplate, setApplyToTemplate] = useState(false);

  const initial: EditableLine[] =
    cat.subLines.length > 0
      ? cat.subLines.map((s) => ({ key: s.subcategoryId, label: s.name, subcategoryId: s.subcategoryId, planned: s.planned }))
      : [{ key: 'all', label: cat.name, subcategoryId: null, planned: cat.planned }];
  const [lines, setLines] = useState(initial);

  const save = useAction(
    async () => {
      for (const line of lines) {
        const original = initial.find((l) => l.key === line.key);
        if (line.planned === null || line.planned === original?.planned) continue;
        await api.put(`/months/${month}/lines`, {
          categoryId: cat.categoryId,
          subcategoryId: line.subcategoryId,
          plannedCents: line.planned,
          applyToTemplate,
        });
      }
    },
    { success: 'Budget du mois mis à jour', onSuccess: onClose },
  );

  const goExpenses = (): void => {
    onClose();
    navigate(`/depenses?m=${month}&cat=${cat.categoryId}`);
  };

  return (
    <Sheet title={cat.name} onClose={onClose}>
      <div className="stack">
        <div className="hstack wrap">
          <span className="badge">{KIND_LABEL[cat.kind]}</span>
          {cat.pendingCount > 0 ? <span className="badge badge-warn">{cat.pendingCount} à confirmer</span> : null}
        </div>

        <div className="card stack">
          <Line label="Budget prévu">
            <Money cents={cat.planned} />
          </Line>
          {cat.transfersIn - cat.transfersOut !== 0 ? (
            <Line label="Virements">
              <Money cents={cat.transfersIn - cat.transfersOut} signed />
            </Line>
          ) : null}
          {cat.carryIn !== 0 ? (
            <Line label={cat.kind === 'provision' ? 'Provision accumulée' : 'Report du mois précédent'}>
              <Money cents={cat.carryIn} signed />
            </Line>
          ) : null}
          <Line label="Disponible" strong>
            <Money cents={cat.effective} />
          </Line>
          <Progress ratio={cat.ratio} status={cat.status} />
          <Line label="Dépensé">
            <Money cents={cat.spent} />
          </Line>
          <Line label="Reste" strong>
            <Money cents={cat.remaining} className={cat.remaining < 0 ? 'bad' : ''} />
          </Line>
          {cat.kind === 'variable' ? (
            <Line label="Projection fin de mois">
              <Money cents={cat.projected} className={cat.projected > cat.effective ? 'warn' : ''} />
            </Line>
          ) : null}
        </div>

        {cat.subLines.length > 0 && !editing ? (
          <div className="card stack">
            <span className="card-title">Sous-lignes</span>
            {cat.subLines.map((s) => (
              <div key={s.subcategoryId} className="stack-sm">
                <div className="spread">
                  <span>{s.name}</span>
                  <span className="num muted small">
                    <Money cents={s.spent} /> / <Money cents={s.planned} />
                  </span>
                </div>
                <Progress ratio={s.planned > 0 ? s.spent / s.planned : s.spent > 0 ? 1 : 0} status={s.spent > s.planned ? 'over' : s.planned > 0 && s.spent / s.planned > 0.8 ? 'warn' : 'ok'} />
              </div>
            ))}
          </div>
        ) : null}

        {editing ? (
          <div className="card stack">
            <span className="card-title">Budget prévu de ce mois</span>
            {lines.map((line) => (
              <label key={line.key} className="field">
                <span className="field-label">{line.label}</span>
                <MoneyInput
                  value={line.planned}
                  onChange={(c) => setLines(lines.map((l) => (l.key === line.key ? { ...l, planned: c } : l)))}
                />
              </label>
            ))}
            <label className="hstack">
              <input type="checkbox" checked={applyToTemplate} onChange={(e) => setApplyToTemplate(e.target.checked)} />
              <span className="small">Réutiliser ce montant pour les prochains mois créés</span>
            </label>
            <button className="btn btn-primary btn-block" disabled={save.isPending} onClick={() => save.mutate(undefined)}>
              Enregistrer
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setEditing(false)}>
              Annuler
            </button>
          </div>
        ) : (
          <div className="stack-sm">
            <button className="btn btn-block" onClick={goExpenses}>
              Voir les dépenses ({cat.expenseCount})
            </button>
            {!cat.isSystem ? (
              <button className="btn btn-block" onClick={() => setEditing(true)}>
                Ajuster le budget du mois
              </button>
            ) : null}
            <button className="btn btn-block" onClick={onTransfer}>
              Virer entre enveloppes
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
