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
  const [connections, setConnections] = useState(null);
  const [people, setPeople] = useState([]);
  const [test, setTest] = useState({ person_id: '', channel: 'slack' });
  const [testResult, setTestResult] = useState(null);
  const [sending, setSending] = useState(false);

  const refreshConnections = () => api.connections().then(setConnections).catch(() => setConnections(null));

  useEffect(() => {
    api.integrations().then(setStatus).catch((e) => setError(e.message));
    api.people().then(setPeople).catch(() => {});
    refreshConnections();
  }, []);

  async function sendTest(e) {
    e.preventDefault();
    setSending(true);
    setTestResult(null);
    try {
      await api.testMessage({ ...test, person_id: Number(test.person_id) });
      setTestResult({ ok: true, text: 'Sent. Check the inbox or Slack of that person.' });
      api.people().then(setPeople).catch(() => {});
    } catch (err) {
      setTestResult({ ok: false, text: err.message });
    } finally {
      setSending(false);
    }
  }

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

      <section className="card">
        <div className="card-head">
          <h3>Delivery accounts</h3>
          <button className="btn sm" onClick={refreshConnections}>Refresh</button>
        </div>
        <div className="chips" style={{ marginBottom: 14 }}>
          {[['slack', 'Slack'], ['gmail', 'Email (Gmail)']].map(([key, name]) => (
            <span key={key} className={`badge ${connections ? (connections[key] ? 'ok' : 'bad') : ''}`}>
              {name}: {connections ? (connections[key] ? 'connected' : 'not connected') : 'unknown'}
            </span>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Connect Slack and Gmail in the panel below, then press Refresh. Slack member IDs are found automatically from each person’s email.
        </p>
        <form onSubmit={sendTest} className="grid">
          <div className="field">
            <label htmlFor="tperson">Send a test to</label>
            <select id="tperson" required value={test.person_id} onChange={(e) => setTest({ ...test, person_id: e.target.value })}>
              <option value="">Select person</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tchan">Through</label>
            <select id="tchan" value={test.channel} onChange={(e) => setTest({ ...test, channel: e.target.value })}>
              <option value="slack">Slack</option>
              <option value="email">Email</option>
            </select>
          </div>
          <button className="btn primary" disabled={sending || !test.person_id}>{sending ? 'Sending…' : 'Send test message'}</button>
        </form>
        {testResult && <p className={testResult.ok ? 'summary' : 'error'} style={{ marginTop: 14, marginBottom: 0 }}>{testResult.text}</p>}
      </section>

      <div ref={box} className="card embed-box" style={{ height: 640 }} />
    </>
  );
}
