import { Navigate, Route, Routes } from 'react-router-dom';
import { TabBar } from './components/TabBar';
import { WhoAreYou } from './components/WhoAreYou';
import { ErrorBox, Loading } from './components/ui';
import { AppProvider, useApp } from './lib/app-context';
import { useSession } from './lib/queries';
import { AddExpense } from './pages/AddExpense';
import { Categories } from './pages/Categories';
import { Expenses } from './pages/Expenses';
import { Home } from './pages/Home';
import { Month } from './pages/Month';
import { More } from './pages/More';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';
import { Tags } from './pages/Tags';

function Shell(): JSX.Element {
  const { me } = useApp();
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/depenses" element={<Expenses />} />
        <Route path="/ajouter" element={<AddExpense />} />
        <Route path="/plus" element={<More />} />
        <Route path="/revenus" element={<Month />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/tags" element={<Tags />} />
        <Route path="/reglages" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TabBar />
      {me ? null : <WhoAreYou />}
    </div>
  );
}

export function App(): JSX.Element {
  const session = useSession();
  if (session.isLoading) return <Loading />;
  if (session.error || !session.data) return <ErrorBox error={session.error} />;
  if (session.data.needsSetup) return <Setup />;
  return (
    <AppProvider session={session.data}>
      <Shell />
    </AppProvider>
  );
}
