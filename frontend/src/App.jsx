import { useState } from 'react';
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
      </nav>
      <main>
        <Page />
      </main>
    </div>
  );
}
