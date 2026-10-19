import { useEffect, useState } from 'react';
import { api } from './api.js';
import LoginPage from './pages/LoginPage.jsx';
import ActionsPage from './pages/ActionsPage.jsx';
import SetupPage from './pages/SetupPage.jsx';
import IntegrationsPage from './pages/IntegrationsPage.jsx';

const PAGES = {
  actions: ['Actions', ActionsPage],
  setup: ['People & teams', SetupPage],
  integrations: ['Integrations', IntegrationsPage],
};

export default function App() {
  const [page, setPage] = useState('actions');
  const [session, setSession] = useState('checking'); // checking | in | out

  const refresh = () => api.me().then((m) => setSession(m.signedIn ? 'in' : 'out')).catch(() => setSession('out'));
  useEffect(() => {
    refresh();
    const out = () => setSession('out');
    window.addEventListener('ac-signed-out', out);
    return () => window.removeEventListener('ac-signed-out', out);
  }, []);

  if (session === 'checking') return null;
  if (session === 'out') return <LoginPage onSignedIn={refresh} />;
  const Page = PAGES[page][1];
  return (
    <div className="shell">
      <nav>
        <strong>Action Correction</strong>
        {Object.entries(PAGES).map(([key, [label]]) => (
          <button key={key} className={key === page ? 'active' : ''} onClick={() => setPage(key)}>
            {label}
          </button>
        ))}
        <button style={{ marginLeft: 'auto' }} onClick={() => api.logout().then(refresh)}>Sign out</button>
      </nav>
      <main>
        <Page />
      </main>
    </div>
  );
}
