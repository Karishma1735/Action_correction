import { useState } from 'react';
import { api } from '../api.js';

export default function LoginPage({ onSignedIn }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      onSignedIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <form className="panel" onSubmit={submit} style={{ maxWidth: 360, margin: '80px auto' }}>
        <h2>Sign in</h2>
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        {error && <p className="error">{error}</p>}
        <button disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
