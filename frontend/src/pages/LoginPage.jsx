import { useState } from 'react';
import { api } from '../api.js';

export default function LoginPage({ onSignedIn }) {
  const [mode, setMode] = useState('login'); // login | signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await (signup ? api.signup : api.login)(email, password);
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
        <h2>{signup ? 'Create account' : 'Sign in'}</h2>
        <input type="email" placeholder="you@viasocket.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
        <input
          type="password"
          placeholder={signup ? 'Password (min 8 characters)' : 'Password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={signup ? 'new-password' : 'current-password'}
        />
        {error && <p className="error">{error}</p>}
        <button disabled={busy || !email || !password}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button>
        <p>
          {signup ? 'Already have an account? ' : 'New here? '}
          <a href="#" onClick={(e) => { e.preventDefault(); setError(''); setMode(signup ? 'login' : 'signup'); }}>
            {signup ? 'Sign in' : 'Create an account'}
          </a>
        </p>
      </form>
    </main>
  );
}
