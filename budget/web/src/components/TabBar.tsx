import { NavLink } from 'react-router-dom';
import { IconBudget, IconList, IconMore } from './icons';

const linkClass = ({ isActive }: { isActive: boolean }): string => `tab${isActive ? ' active' : ''}`;

export function TabBar(): JSX.Element {
  return (
    <nav className="tabbar" aria-label="Navigation principale">
      <div className="tabbar-inner">
        <NavLink to="/" end className={linkClass}>
          <IconBudget />
          Budget
        </NavLink>
        <NavLink to="/depenses" className={linkClass}>
          <IconList />
          Dépenses
        </NavLink>
        <NavLink to="/ajouter" className="tab-add" aria-label="Ajouter une dépense">
          +
        </NavLink>
        <NavLink to="/plus" className={linkClass}>
          <IconMore />
          Plus
        </NavLink>
      </div>
    </nav>
  );
}
