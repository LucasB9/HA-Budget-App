import { useApp } from '../lib/app-context';

export function Home(): JSX.Element {
  const { catalog, session } = useApp();
  return (
    <div className="page">
      <h1 className="page-title">Budget</h1>
      <p className="muted">
        {catalog.flatMap((g) => g.categories).length} catégories · {session.currentMonth}
      </p>
    </div>
  );
}
