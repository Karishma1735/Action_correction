import { useEffect, useState } from 'react';
import { api } from './api.js';
import ActionsPage from './pages/ActionsPage.jsx';
import SetupPage from './pages/SetupPage.jsx';
import MatrixPage from './pages/MatrixPage.jsx';
import IntegrationsPage from './pages/IntegrationsPage.jsx';
import LoginPage from './pages/LoginPage.jsx';

const PAGES = {
  actions: ['Actions', ActionsPage],
  matrix: ['Matrix', MatrixPage],
  setup: ['People & teams', SetupPage],
  integrations: ['Integrations', IntegrationsPage],
};

export default function App() {
  const [page, setPage] = useState('actions');
  const [session, setSession] = useState({ state: 'checking', email: null }); // checking | in | out

  const refresh = () =>
    api.me()
      .then((m) => setSession({ state: m.signedIn ? 'in' : 'out', email: m.email }))
      .catch(() => setSession({ state: 'out', email: null }));
  useEffect(() => {
    refresh();
    const out = () => setSession({ state: 'out', email: null });
    window.addEventListener('ac-signed-out', out);
    return () => window.removeEventListener('ac-signed-out', out);
  }, []);

  if (session.state === 'checking') return null;
  if (session.state === 'out') return <LoginPage onSignedIn={refresh} />;

  const Page = PAGES[page][1];
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand"><span className="brand-mark">✓</span><span>Plug Informatrix</span></div>
          <nav className="tabs">
            {Object.entries(PAGES).map(([key, [label]]) => (
              <button key={key} className={`tab${key === page ? ' active' : ''}`} onClick={() => setPage(key)}>{label}</button>
            ))}
          </nav>
          <div className="user">
            <span title={session.email}>{session.email}</span>
            <button className="btn sm" onClick={() => api.logout().then(refresh)}>Sign out</button>
          </div>
        </div>
      </header>
      <main>
        <Page />
      </main>
    </>
  );
}
