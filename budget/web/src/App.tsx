import { Navigate, Route, Routes } from 'react-router-dom';
import { WhoAreYou } from './components/WhoAreYou';
import { ErrorBox, Loading } from './components/ui';
import { AppProvider, useApp } from './lib/app-context';
import { useSession } from './lib/queries';
import { Home } from './pages/Home';
import { Setup } from './pages/Setup';

function Shell(): JSX.Element {
  const { me } = useApp();
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
