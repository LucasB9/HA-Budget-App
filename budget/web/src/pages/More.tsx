import { Link } from 'react-router-dom';

const ITEMS: { to: string; title: string; sub: string }[] = [
  { to: '/epargne', title: 'Épargne', sub: 'Comptes, versements du mois, graphiques, objectifs' },
  { to: '/revenus', title: 'Revenus & virements', sub: 'Revenus du mois, ratio de répartition, virements entre enveloppes' },
  { to: '/categories', title: 'Catégories', sub: 'Groupes, sous-lignes, report, archivage, fusion' },
  { to: '/tags', title: 'Par tag', sub: 'Totaux par tag, toutes catégories et tous mois' },
  { to: '/reglages', title: 'Réglages', sub: 'Foyer, répartition par défaut, utilisateur' },
];

export function More(): JSX.Element {
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Plus</h1>
      </div>
      <div className="card card-flush list">
        {ITEMS.map((i) => (
          <Link key={i.to} to={i.to} className="row" style={{ color: 'inherit' }}>
            <div className="row-main">
              <div className="row-title">{i.title}</div>
              <div className="row-sub">{i.sub}</div>
            </div>
            <span className="chevron" />
          </Link>
        ))}
      </div>
    </div>
  );
}
