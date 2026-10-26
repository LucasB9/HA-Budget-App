import { useState } from 'react';
import { api } from '../lib/api';
import { useAction } from '../lib/queries';
import { Field, MoneyInput, Segmented } from '../components/ui';

type Mode = 'import' | 'empty';

/** First-run wizard: load the real budget from a JSON seed, or start from an empty household. */
export function Setup(): JSX.Element {
  const [mode, setMode] = useState<Mode>('import');
  const [json, setJson] = useState('');
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [names, setNames] = useState(['', '']);
  const [incomes, setIncomes] = useState<(number | null)[]>([null, null]);

  const submit = useAction((seed: unknown) => api.post('/setup/seed', seed), { success: 'Budget importé' });

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setFileName(file.name);
    setJson(await file.text());
    setParseError(null);
  };

  const importJson = (): void => {
    try {
      submit.mutate(JSON.parse(json));
      setParseError(null);
    } catch {
      setParseError("Ce fichier n'est pas un JSON valide.");
    }
  };

  const loadExample = async (): Promise<void> => {
    const example = await api.get<unknown>('/setup/example');
    setJson(JSON.stringify(example, null, 2));
    setFileName('seed.example.json');
    setParseError(null);
  };

  const startEmpty = (): void => {
    submit.mutate({
      version: 1,
      people: names.map((name, i) => ({ name: name.trim(), monthlyIncome: (incomes[i] ?? 0) / 100 })),
      defaultSplitMode: 'income',
      groups: [],
      savingsAccounts: [],
    });
  };

  const emptyValid = names.every((n) => n.trim().length > 0) && names[0]?.trim().toLowerCase() !== names[1]?.trim().toLowerCase();

  return (
    <div className="app">
      <div className="page">
        <div className="page-head">
          <h1 className="page-title">Bienvenue</h1>
        </div>
        <p className="muted">
          Configurons votre budget de foyer. Vos montants restent sur votre Home Assistant : rien n'est stocké dans le dépôt
          GitHub.
        </p>

        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'import', label: 'Importer un JSON' },
            { value: 'empty', label: 'Partir de zéro' },
          ]}
        />

        {mode === 'import' ? (
          <div className="card stack">
            <Field label="Fichier de budget (seed.local.json)">
              <input type="file" accept="application/json,.json" onChange={(e) => void onFile(e.target.files?.[0])} />
            </Field>
            <Field label="ou collez le JSON" hint={fileName ? `Chargé : ${fileName}` : undefined}>
              <textarea
                className="textarea"
                rows={6}
                value={json}
                onChange={(e) => {
                  setJson(e.target.value);
                  setFileName('');
                }}
                placeholder='{ "version": 1, "people": [ ... ] }'
              />
            </Field>
            {parseError ? <div className="banner banner-bad">{parseError}</div> : null}
            {submit.error ? <div className="banner banner-bad">{submit.error.message}</div> : null}
            <button className="btn btn-primary btn-block" disabled={!json.trim() || submit.isPending} onClick={importJson}>
              Importer
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => void loadExample()}>
              Charger l'exemple (montants fictifs)
            </button>
          </div>
        ) : (
          <div className="card stack">
            {[0, 1].map((i) => (
              <div key={i} className="stack-sm">
                <Field label={`Prénom de la personne ${i + 1}`}>
                  <input
                    className="input"
                    value={names[i]}
                    onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))}
                  />
                </Field>
                <Field label="Revenu mensuel (€)">
                  <MoneyInput
                    value={incomes[i] ?? null}
                    onChange={(c) => setIncomes(incomes.map((v, j) => (j === i ? c : v)))}
                  />
                </Field>
              </div>
            ))}
            {submit.error ? <div className="banner banner-bad">{submit.error.message}</div> : null}
            <button className="btn btn-primary btn-block" disabled={!emptyValid || submit.isPending} onClick={startEmpty}>
              Commencer
            </button>
            <p className="muted small">Vous créerez vos catégories ensuite, depuis « Plus › Catégories ».</p>
          </div>
        )}
      </div>
    </div>
  );
}

