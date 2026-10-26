import { useApp } from '../lib/app-context';
import { Sheet } from './ui';

/** Shown when Home Assistant did not tell us who is logged in and no choice is remembered locally. */
export function WhoAreYou(): JSX.Element {
  const { people, setMe } = useApp();
  return (
    <Sheet title="Qui es-tu ?" onClose={() => undefined}>
      <div className="stack">
        <p className="muted">Ce choix est mémorisé sur cet appareil et sert à noter qui ajoute une dépense.</p>
        {people.map((p) => (
          <button key={p.id} className="btn btn-primary btn-block" onClick={() => setMe(p.id)}>
            {p.name}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
