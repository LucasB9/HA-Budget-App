import { useState } from 'react';
import type { Cents, CategoryDto, DefaultSplit, GroupDto, SubcategoryDto } from '@budget/shared';
import { ConfirmSheet, Field, Money, MoneyInput, Segmented, Sheet } from '../components/ui';
import { api } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useAction } from '../lib/queries';

type Kind = 'fixed' | 'variable' | 'provision';

const KIND_LABEL: Record<string, string> = { fixed: 'Fixe', variable: 'Variable', provision: 'Provision', system: 'Imprévus' };

function moveInList(ids: string[], id: string, dir: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const target = index + dir;
  if (index < 0 || target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target] as string, next[index] as string];
  return next;
}

// ------------------------------------------------------------------ group

function GroupSheet({ group, groups, onClose, onAddCategory }: {
  group: GroupDto | null;
  groups: GroupDto[];
  onClose: () => void;
  onAddCategory: (groupId: string) => void;
}): JSX.Element {
  const [name, setName] = useState(group?.name ?? '');
  const save = useAction(
    () => (group ? api.patch(`/groups/${group.id}`, { name }) : api.post('/groups', { name })),
    { success: group ? 'Groupe renommé' : 'Groupe créé', onSuccess: onClose },
  );
  const archive = useAction(() => api.patch(`/groups/${group?.id ?? ''}`, { archived: !group?.archived }), { onSuccess: onClose });
  const move = useAction(
    (dir: -1 | 1) => api.post('/catalog/reorder', { kind: 'group', ids: moveInList(groups.map((g) => g.id), group?.id ?? '', dir) }),
  );

  return (
    <Sheet title={group ? 'Groupe' : 'Nouveau groupe'} onClose={onClose}>
      <div className="stack">
        <Field label="Nom">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <button className="btn btn-primary btn-block" disabled={!name.trim() || save.isPending} onClick={() => save.mutate(undefined)}>
          Enregistrer
        </button>
        {group ? (
          <>
            <button className="btn btn-block" onClick={() => onAddCategory(group.id)}>
              Ajouter une catégorie
            </button>
            <div className="hstack">
              <button className="btn grow" onClick={() => move.mutate(-1)}>
                ↑ Monter
              </button>
              <button className="btn grow" onClick={() => move.mutate(1)}>
                ↓ Descendre
              </button>
            </div>
            <button className="btn btn-block btn-danger" onClick={() => archive.mutate(undefined)}>
              {group.archived ? 'Désarchiver' : 'Archiver le groupe'}
            </button>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ sub-line

function SubSheet({ categoryId, sub, onClose }: { categoryId: string; sub: SubcategoryDto | null; onClose: () => void }): JSX.Element {
  const [name, setName] = useState(sub?.name ?? '');
  const [planned, setPlanned] = useState<Cents | null>(sub?.plannedCents ?? 0);
  const save = useAction(
    () =>
      sub
        ? api.patch(`/subcategories/${sub.id}`, { name, plannedCents: planned ?? 0 })
        : api.post('/subcategories', { categoryId, name, plannedCents: planned ?? 0 }),
    { success: 'Sous-ligne enregistrée', onSuccess: onClose },
  );
  const archive = useAction(() => api.patch(`/subcategories/${sub?.id ?? ''}`, { archived: !sub?.archived }), { onSuccess: onClose });
  return (
    <Sheet title={sub ? 'Sous-ligne' : 'Nouvelle sous-ligne'} onClose={onClose}>
      <div className="stack">
        <Field label="Nom">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Budget mensuel prévu">
          <MoneyInput value={planned} onChange={setPlanned} />
        </Field>
        <p className="muted small">S'applique au mois en cours et aux suivants, jamais aux mois passés.</p>
        <button className="btn btn-primary btn-block" disabled={!name.trim() || save.isPending} onClick={() => save.mutate(undefined)}>
          Enregistrer
        </button>
        {sub ? (
          <button className="btn btn-block btn-danger" onClick={() => archive.mutate(undefined)}>
            {sub.archived ? 'Désarchiver' : 'Archiver la sous-ligne'}
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ category

function MergeSheet({ cat, onClose }: { cat: CategoryDto; onClose: () => void }): JSX.Element {
  const { catalog } = useApp();
  const [target, setTarget] = useState('');
  const [confirm, setConfirm] = useState(false);
  const merge = useAction(() => api.post(`/categories/${cat.id}/merge`, { intoCategoryId: target }), {
    success: 'Catégories fusionnées',
    onSuccess: onClose,
  });
  const targetName = catalog.flatMap((g) => g.categories).find((c) => c.id === target)?.name ?? '';
  return (
    <Sheet title={`Fusionner « ${cat.name} »`} onClose={onClose}>
      <div className="stack">
        <p className="muted">
          Toutes les dépenses, budgets et virements de cette catégorie sont déplacés vers la catégorie choisie, puis celle-ci est
          archivée. Le détail des sous-lignes est perdu.
        </p>
        <Field label="Fusionner dans">
          <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="" disabled>
              Choisir…
            </option>
            {catalog.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.categories
                  .filter((c) => !c.archived && c.id !== cat.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <button className="btn btn-danger btn-block" disabled={!target} onClick={() => setConfirm(true)}>
          Fusionner
        </button>
      </div>
      {confirm ? (
        <ConfirmSheet
          title="Fusionner ?"
          message={`« ${cat.name} » sera fusionnée dans « ${targetName} » puis archivée.`}
          confirmLabel="Fusionner"
          danger
          onConfirm={() => merge.mutate(undefined)}
          onClose={() => setConfirm(false)}
        />
      ) : null}
    </Sheet>
  );
}

function CategorySheet({ cat, groupId, onClose }: { cat: CategoryDto | null; groupId: string | null; onClose: () => void }): JSX.Element {
  const { catalog, people } = useApp();
  const [name, setName] = useState(cat?.name ?? '');
  const [group, setGroup] = useState(cat?.groupId ?? groupId ?? catalog[0]?.id ?? '');
  const [kind, setKind] = useState<Kind>(cat && cat.kind !== 'system' ? cat.kind : 'variable');
  const [planned, setPlanned] = useState<Cents | null>(cat?.plannedCents ?? 0);
  const [rollover, setRollover] = useState(cat?.rollover ?? false);
  const [day, setDay] = useState(String(cat?.fixedDay ?? 1));
  const [payer, setPayer] = useState<string>(cat?.defaultPayerId ?? people[0]?.id ?? '');
  const [split, setSplit] = useState<DefaultSplit>(cat?.defaultSplit ?? 'income');
  const [subSheet, setSubSheet] = useState<{ sub: SubcategoryDto | null } | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);

  const activeSubs = cat?.subcategories.filter((s) => !s.archived) ?? [];
  const hasSubs = activeSubs.length > 0;
  const siblings = (catalog.find((g) => g.id === cat?.groupId)?.categories ?? []).map((c) => c.id);

  const save = useAction(
    () => {
      const body = {
        groupId: group,
        name,
        kind: cat?.isSystem ? undefined : kind,
        plannedCents: hasSubs ? undefined : (planned ?? 0),
        rollover,
        fixedDay: Math.min(31, Math.max(1, Number(day) || 1)),
        defaultPayerId: payer || null,
        defaultSplit: split,
      };
      return cat ? api.patch(`/categories/${cat.id}`, body) : api.post('/categories', body);
    },
    { success: cat ? 'Catégorie enregistrée' : 'Catégorie créée', onSuccess: onClose },
  );
  const archive = useAction(() => api.patch(`/categories/${cat?.id ?? ''}`, { archived: !cat?.archived }), {
    success: cat?.archived ? 'Catégorie restaurée' : 'Catégorie archivée',
    onSuccess: onClose,
  });
  const move = useAction((dir: -1 | 1) => api.post('/catalog/reorder', { kind: 'category', ids: moveInList(siblings, cat?.id ?? '', dir) }));

  return (
    <Sheet title={cat ? cat.name : 'Nouvelle catégorie'} onClose={onClose}>
      <div className="stack">
        {cat?.isSystem ? <div className="banner banner-info">Catégorie intégrée : elle reçoit les dépenses qui ne rentrent nulle part.</div> : null}
        <Field label="Nom">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={cat?.isSystem === true} />
        </Field>
        {!cat?.isSystem ? (
          <>
            <Field label="Groupe">
              <select className="select" value={group} onChange={(e) => setGroup(e.target.value)}>
                {catalog.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type" group>
              <Segmented
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'fixed', label: 'Fixe' },
                  { value: 'variable', label: 'Variable' },
                  { value: 'provision', label: 'Provision' },
                ]}
              />
            </Field>
            {hasSubs ? (
              <div className="stack-sm">
                <span className="field-label">Budget mensuel prévu</span>
                <Money cents={cat?.plannedCents ?? 0} />
                <span className="muted small">Somme des sous-lignes.</span>
              </div>
            ) : (
              <Field label="Budget mensuel prévu (modèle)" hint="S'applique au mois en cours et aux suivants, jamais aux mois passés.">
                <MoneyInput value={planned} onChange={setPlanned} />
              </Field>
            )}
            {kind === 'variable' ? (
              <label className="hstack">
                <input type="checkbox" checked={rollover} onChange={(e) => setRollover(e.target.checked)} />
                <span>Reporter le non-dépensé au mois suivant (rollover)</span>
              </label>
            ) : null}
            {kind === 'provision' ? <p className="muted small">Une provision s'accumule de mois en mois jusqu'à ce qu'elle soit dépensée.</p> : null}
            {kind === 'fixed' ? (
              <>
                <Field label="Jour de création de la dépense (1–31)">
                  <input className="input" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} />
                </Field>
                <Field label="Payée par" group>
                  <Segmented value={payer} onChange={setPayer} options={people.map((p) => ({ value: p.id, label: p.name }))} />
                </Field>
                <Field label="Répartition" group>
                  <Segmented
                    value={split}
                    onChange={setSplit}
                    options={[
                      { value: 'income', label: 'Revenus' },
                      { value: 'equal', label: '50/50' },
                      { value: 'personal', label: '100 % payeur' },
                    ]}
                  />
                </Field>
              </>
            ) : null}
          </>
        ) : null}

        <button className="btn btn-primary btn-block" disabled={!name.trim() || !group || save.isPending} onClick={() => save.mutate(undefined)}>
          Enregistrer
        </button>

        {cat && !cat.isSystem ? (
          <>
            <div className="card stack">
              <div className="spread">
                <span className="card-title">Sous-lignes</span>
                <button className="btn btn-sm" onClick={() => setSubSheet({ sub: null })}>
                  Ajouter
                </button>
              </div>
              {cat.subcategories.length === 0 ? <span className="muted small">Aucune. Les dépenses s'imputent à la catégorie entière.</span> : null}
              {cat.subcategories.map((s) => (
                <button key={s.id} className="row" style={{ padding: '8px 0' }} onClick={() => setSubSheet({ sub: s })}>
                  <span className="row-main row-title" style={s.archived ? { opacity: 0.5 } : undefined}>
                    {s.name}
                    {s.archived ? ' (archivée)' : ''}
                  </span>
                  <Money cents={s.plannedCents} />
                </button>
              ))}
            </div>
            <div className="hstack">
              <button className="btn grow" onClick={() => move.mutate(-1)}>
                ↑ Monter
              </button>
              <button className="btn grow" onClick={() => move.mutate(1)}>
                ↓ Descendre
              </button>
            </div>
            <button className="btn btn-block" onClick={() => setMergeOpen(true)}>
              Fusionner dans une autre catégorie…
            </button>
            <button className="btn btn-block btn-danger" onClick={() => archive.mutate(undefined)}>
              {cat.archived ? 'Restaurer' : 'Archiver (l’historique est conservé)'}
            </button>
          </>
        ) : null}
      </div>
      {subSheet && cat ? <SubSheet categoryId={cat.id} sub={subSheet.sub} onClose={() => setSubSheet(null)} /> : null}
      {mergeOpen && cat ? <MergeSheet cat={cat} onClose={() => setMergeOpen(false)} /> : null}
    </Sheet>
  );
}

// ------------------------------------------------------------------ page

export function Categories(): JSX.Element {
  const { catalog } = useApp();
  const [showArchived, setShowArchived] = useState(false);
  const [groupSheet, setGroupSheet] = useState<{ group: GroupDto | null } | null>(null);
  // Only the id is kept so the open sheet always reflects the latest catalog (e.g. after adding a sub-line).
  const [catSheet, setCatSheet] = useState<{ catId: string | null; groupId: string | null } | null>(null);
  const openCat = catSheet?.catId ? catalog.flatMap((g) => g.categories).find((c) => c.id === catSheet.catId) ?? null : null;

  const groups = catalog.filter((g) => showArchived || !g.archived);

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Catégories</h1>
        <button className="btn btn-sm" onClick={() => setGroupSheet({ group: null })}>
          Nouveau groupe
        </button>
      </div>
      <label className="hstack small">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        <span>Afficher les archivées</span>
      </label>

      {groups.map((g) => (
        <section key={g.id} className="stack-sm">
          <div className="spread section-title">
            <button className="btn btn-ghost btn-sm" style={{ padding: 0, minHeight: 0, color: 'inherit', textTransform: 'inherit' }} onClick={() => setGroupSheet({ group: g })}>
              {g.name}
              {g.archived ? ' (archivé)' : ''} ✎
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setCatSheet({ catId: null, groupId: g.id })}>
              + Catégorie
            </button>
          </div>
          <div className="card card-flush list">
            {g.categories
              .filter((c) => showArchived || !c.archived)
              .map((c) => (
                <button key={c.id} className="row" onClick={() => setCatSheet({ catId: c.id, groupId: null })}>
                  <div className="row-main">
                    <div className="row-title" style={c.archived ? { opacity: 0.5 } : undefined}>
                      {c.name}
                    </div>
                    <div className="row-sub">
                      {KIND_LABEL[c.kind]}
                      {c.rollover ? ' · report' : ''}
                      {c.subcategories.some((s) => !s.archived) ? ` · ${c.subcategories.filter((s) => !s.archived).length} sous-lignes` : ''}
                      {c.archived ? ' · archivée' : ''}
                    </div>
                  </div>
                  <Money cents={c.plannedCents} compact />
                </button>
              ))}
            {g.categories.filter((c) => showArchived || !c.archived).length === 0 ? <div className="empty small">Aucune catégorie</div> : null}
          </div>
        </section>
      ))}

      {groupSheet ? (
        <GroupSheet
          group={groupSheet.group}
          groups={catalog}
          onClose={() => setGroupSheet(null)}
          onAddCategory={(groupId) => {
            setGroupSheet(null);
            setCatSheet({ catId: null, groupId });
          }}
        />
      ) : null}
      {catSheet ? <CategorySheet cat={openCat} groupId={catSheet.groupId} onClose={() => setCatSheet(null)} /> : null}
    </div>
  );
}
