import { useEffect, useState } from 'react';
import { api } from '../api.js';

// The viaSocket Embed component is mounted in #viasocket-embed once the viaSocket
// skill is installed and the embed API details are known.
export default function IntegrationsPage() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.integrations().then(setStatus).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <h2>Integrations</h2>
      <p>Connect Slack and email here. Reminders and escalations are delivered through the accounts you connect.</p>
      {error && <p className="error">{error}</p>}
      {status && (
        <p>
          Delivery mode: <strong>{status.notifier}</strong> · viaSocket secret configured:{' '}
          <strong>{status.viasocketConfigured ? 'yes' : 'no'}</strong>
        </p>
      )}
      <div id="viasocket-embed" className="panel">
        viaSocket embed will appear here once the integration is wired up.
      </div>
    </>
  );
}
