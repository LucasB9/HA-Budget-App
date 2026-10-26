import { useNavigate, useSearchParams } from 'react-router-dom';
import { ExpenseForm } from '../components/ExpenseForm';

export function AddExpense(): JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialCategoryId = params.get('cat') ?? undefined;
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Nouvelle dépense</h1>
      </div>
      <ExpenseForm {...(initialCategoryId ? { initialCategoryId } : {})} onDone={() => navigate('/depenses')} />
    </div>
  );
}
