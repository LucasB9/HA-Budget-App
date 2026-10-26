import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, apiUrl, postText } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useAction } from '../lib/queries';
import { Field, Sheet } from './ui';
import { useToast } from './toast';

interface ImportReport {
  dryRun: boolean;
  imported: number;
  skipped: number;
  errors: { line: number; message: string }[];
}

// ------------------------------------------------------------------ JSON backup

function RestoreSheet({ text, summary, onClose }: { text: string; summary: string; onClose: () => void }): JSX.Element {
  const [word, setWord] = useState('');
  const restore = useAction(
    () => api.post<{ rows: number }>('/backup/restore', { confirm: 'RESTAURER', backup: JSON.parse(text) }),
    { success: 'Sauvegarde restaurée', onSuccess: onClose },
  );
  return (
    <Sheet title="Restaurer cette sauvegarde ?" onClose={onClose}>
      <div className="stack">
        <p className="muted">{summary}</p>
        <div className="banner banner-bad">
          Toutes les données actuelles (budget, dépenses, épargne, récaps) seront remplacées. Une copie de la base actuelle est conservée
          dans le dossier de données de l'app avant le remplacement.
        </div>
        <Field label="Tapez RESTAURER pour confirmer">
          <input className="input" value={word} onChange={(e) => setWord(e.target.value)} autoCapitalize="characters" />
        </Field>
        <button className="btn btn-danger btn-block" disabled={word !== 'RESTAURER' || restore.isPending} onClick={() => restore.mutate(undefined)}>
          Remplacer mes données
        </button>
        <button className="btn btn-ghost btn-block" onClick={onClose}>
          Annuler
        </button>
      </div>
    </Sheet>
  );
}

function BackupCard(): JSX.Element {
  const toast = useToast();
  const [pending, setPending] = useState<{ text: string; summary: string } | null>(null);

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { format?: string; exportedAt?: string; tables?: Record<string, unknown[]> };
      if (parsed.format !== 'household-budget-backup' || !parsed.tables) throw new Error('format');
      const expenses = parsed.tables.expenses?.length ?? 0;
      const categories = parsed.tables.categories?.length ?? 0;
      setPending({
        text,
        summary: `Sauvegarde du ${parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('fr-FR') : '?'} : ${categories} catégories, ${expenses} dépenses.`,
      });
    } catch {
      toast.show("Ce fichier n'est pas une sauvegarde du Budget.", 'error');
    }
  };

  return (
    <div className="card stack">
      <span className="card-title">Sauvegarde complète (JSON)</span>
      <p className="muted small">
        La base est déjà incluse dans les sauvegardes Home Assistant. Ce fichier sert à la déplacer ou à en garder une copie à part.
      </p>
      <a className="btn btn-block" href={apiUrl('/backup')} download>
        Télécharger la sauvegarde
      </a>
      <Field label="Restaurer depuis un fichier">
        <input type="file" accept="application/json,.json" onChange={(e) => void onFile(e.target.files?.[0])} />
      </Field>
      {pending ? <RestoreSheet text={pending.text} summary={pending.summary} onClose={() => setPending(null)} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ CSV

function CsvImport({ kind, label, columns }: { kind: 'expenses' | 'savings'; label: string; columns: string }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (dryRun: boolean): Promise<void> => {
    if (text === null) return;
    setBusy(true);
    try {
      const result = await postText<ImportReport>(`/import/${kind}${dryRun ? '?dryRun=true' : ''}`, text);
      setReport(result);
      if (!dryRun && result.errors.length === 0) {
        await qc.invalidateQueries();
        toast.show(`${result.imported} ligne${result.imported > 1 ? 's' : ''} importée${result.imported > 1 ? 's' : ''}`);
        setText(null);
        setFileName('');
        setReport(null);
      }
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Import impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-sm">
      <span className="field-label">{label}</span>
      <p className="muted small">Colonnes : {columns}</p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setText(await file.text());
          setFileName(file.name);
          setReport(null);
        }}
      />
      {text !== null ? (
        <div className="hstack">
          <button className="btn grow" disabled={busy} onClick={() => void run(true)}>
            Vérifier
          </button>
          <button className="btn btn-primary grow" disabled={busy || (report !== null && report.errors.length > 0)} onClick={() => void run(false)}>
            Importer
          </button>
        </div>
      ) : null}
      {report ? (
        report.errors.length === 0 ? (
          <div className="banner banner-info">
            {fileName} : {report.imported} ligne{report.imported > 1 ? 's' : ''} valide{report.imported > 1 ? 's' : ''}
            {report.skipped > 0 ? `, ${report.skipped} « à confirmer » ignorée${report.skipped > 1 ? 's' : ''}` : ''}.
          </div>
        ) : (
          <div className="banner banner-bad stack-sm">
            <strong>Rien n'a été importé. Corrigez ces lignes puis réessayez :</strong>
            {report.errors.slice(0, 12).map((e) => (
              <div key={`${e.line}-${e.message}`} className="small">
                Ligne {e.line} : {e.message}
              </div>
            ))}
            {report.errors.length > 12 ? <div className="small">… et {report.errors.length - 12} autres.</div> : null}
          </div>
        )
      ) : null}
    </div>
  );
}

function CsvCard(): JSX.Element {
  return (
    <div className="card stack">
      <span className="card-title">Export et import CSV</span>
      <div className="hstack">
        <a className="btn grow" href={apiUrl('/export/expenses.csv')} download>
          Dépenses (CSV)
        </a>
        <a className="btn grow" href={apiUrl('/export/savings.csv')} download>
          Épargne (CSV)
        </a>
      </div>
      <CsvImport kind="expenses" label="Importer des dépenses" columns="date;montant;categorie (+ sous_ligne;paye_par;repartition;tags;note)" />
      <CsvImport kind="savings" label="Importer de l'épargne" columns="compte;mois;versement (+ solde;note)" />
      <p className="muted small">
        Répartition : <em>revenus</em>, <em>50/50</em>, <em>100% Prénom</em> ou <em>60/40</em>. Les catégories et comptes doivent déjà exister.
      </p>
    </div>
  );
}

function IntegrationsCard(): JSX.Element {
  const { session } = useApp();
  return (
    <div className="card stack">
      <span className="card-title">Home Assistant et Raccourcis</span>
      <p className="small">
        <strong>Capteurs :</strong>{' '}
        {session.inHomeAssistant ? 'publiés (sensor.budget_remaining, _spent, _balance_owed, _savings_rate, _pending_expenses).' : 'actifs uniquement une fois installée comme app Home Assistant.'}
      </p>
      <p className="small">
        <strong>Raccourci iOS :</strong>{' '}
        {session.shortcutEnabled
          ? 'activé. POST /api/shortcut/expense avec un jeton Bearer (voir la documentation de l’app).'
          : 'désactivé. Définissez l’option « shortcut_token » dans la configuration de l’app pour l’activer.'}
      </p>
    </div>
  );
}

export function DataTools(): JSX.Element {
  return (
    <>
      <BackupCard />
      <CsvCard />
      <IntegrationsCard />
    </>
  );
}
