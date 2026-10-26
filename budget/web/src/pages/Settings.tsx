import { useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useAction } from '../lib/queries';
import { Field, Segmented } from '../components/ui';

export function Settings(): JSX.Element {
  const { session, people, me, setMe } = useApp();
  const [names, setNames] = useState(people.map((p) => ({ id: p.id, name: p.name, haUserName: p.haUserName ?? '' })));

  const savePeople = useAction(
    () => api.put('/people', { people: names.map((n) => ({ id: n.id, name: n.name, haUserName: n.haUserName || null })) }),
    { success: 'Foyer enregistré' },
  );
  const patchSettings = useAction((patch: Record<string, unknown>) => api.patch('/settings', patch), { success: 'Réglage enregistré' });

  const namesValid =
    names.every((n) => n.name.trim().length > 0) && names[0]?.name.trim().toLowerCase() !== names[1]?.name.trim().toLowerCase();

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Réglages</h1>
      </div>

      <div className="card stack">
        <span className="card-title">Foyer</span>
        {names.map((n, i) => (
          <div key={n.id} className="stack-sm">
            <Field label={`Personne ${i + 1}`}>
              <input className="input" value={n.name} onChange={(e) => setNames(names.map((x) => (x.id === n.id ? { ...x, name: e.target.value } : x)))} />
            </Field>
            <Field label="Nom d'utilisateur Home Assistant (optionnel)" hint="Sert à reconnaître automatiquement qui ouvre l'app.">
              <input
                className="input"
                value={n.haUserName}
                placeholder={n.name}
                onChange={(e) => setNames(names.map((x) => (x.id === n.id ? { ...x, haUserName: e.target.value } : x)))}
              />
            </Field>
          </div>
        ))}
        <button className="btn btn-primary btn-block" disabled={!namesValid || savePeople.isPending} onClick={() => savePeople.mutate(undefined)}>
          Enregistrer
        </button>
      </div>

      <div className="card stack">
        <span className="card-title">Répartition par défaut</span>
        <Segmented
          label="Répartition par défaut"
          value={session.settings.defaultSplitMode}
          onChange={(v) => patchSettings.mutate({ defaultSplitMode: v })}
          options={[
            { value: 'income', label: 'Selon les revenus' },
            { value: 'equal', label: '50/50' },
          ]}
        />
        <p className="muted small">Modifiable à chaque dépense. Les dépenses existantes ne changent pas.</p>
      </div>

      <div className="card stack">
        <span className="card-title">Récap IA</span>
        {session.aiConfigured ? (
          <p className="muted small">Clé API Anthropic configurée dans les options de l'app Home Assistant.</p>
        ) : (
          <p className="muted small">
            Aucune clé API configurée : ajoutez « anthropic_api_key » dans Paramètres › Apps › Budget › Configuration.
          </p>
        )}
        <label className="hstack">
          <input
            type="checkbox"
            disabled={!session.aiConfigured || patchSettings.isPending}
            checked={session.settings.autoRecap}
            onChange={(e) => patchSettings.mutate({ autoRecap: e.target.checked })}
          />
          <span>Générer automatiquement le récap le 1er de chaque mois</span>
        </label>
      </div>

      <div className="card stack">
        <span className="card-title">Qui es-tu ?</span>
        {session.me ? (
          <p className="muted">Reconnu via Home Assistant : {me?.name}.</p>
        ) : (
          <Segmented
            label="Utilisateur"
            value={me?.id ?? ''}
            onChange={setMe}
            options={people.map((p) => ({ value: p.id, label: p.name }))}
          />
        )}
      </div>

      <p className="muted small" style={{ textAlign: 'center' }}>
        Budget {session.version}
      </p>
    </div>
  );
}
