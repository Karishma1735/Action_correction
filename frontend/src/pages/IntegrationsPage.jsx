import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const EMBED_SCRIPT = 'https://embed.viasocket.com/prod-embedcomponent.js';

function loadEmbedScript() {
  if (window.viaSocket) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = EMBED_SCRIPT;
    el.onload = resolve;
    el.onerror = () => reject(new Error('Could not load the viaSocket embed script'));
    document.head.appendChild(el);
  });
}

// Mounts viaSocket's prebuilt integrations UI so the user can connect Slack and email.
export default function IntegrationsPage() {
  const box = useRef(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.integrations().then(setStatus).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    let embed;
    let cancelled = false;
    (async () => {
      try {
        const [{ token }] = await Promise.all([api.viasocketToken(), loadEmbedScript()]);
        if (cancelled) return;
        embed = window.viaSocket.mount({
          embedToken: token,
          parent: box.current,
          config: { pageheading: 'Integration', showEnabled: true },
        });
        embed.on('flow', (flow) => console.debug('viaSocket flow', flow.action, flow.id));
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => {
      cancelled = true;
      embed?.destroy?.();
    };
  }, []);

  return (
    <>
      <div className="page-head">
        <h2>Integrations</h2>
        <p>Connect Slack and email. Reminders and escalations are delivered through the accounts you connect.</p>
      </div>
      {status && (
        <div className="chips" style={{ marginBottom: 16 }}>
          <span className={`badge ${status.notifier === 'viasocket' ? 'ok' : 'warn'}`}>Delivery: {status.notifier === 'viasocket' ? 'viaSocket' : 'console log only'}</span>
          <span className={`badge ${status.viasocketConfigured ? 'ok' : 'bad'}`}>viaSocket secret {status.viasocketConfigured ? 'configured' : 'missing'}</span>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div ref={box} className="card embed-box" style={{ height: 640 }} />
    </>
  );
}
