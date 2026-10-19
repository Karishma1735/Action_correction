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
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="brand"><span className="brand-mark">✓</span><span>Plug Informatrix</span></div>
        <h2>{signup ? 'Create your account' : 'Welcome back'}</h2>
        <p className="sub">{signup ? 'Use your @viasocket.com email address.' : 'Sign in with your @viasocket.com account.'}</p>
        <form onSubmit={submit}>
          {error && <p className="error">{error}</p>}
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input id="email" type="email" placeholder="you@viasocket.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder={signup ? 'At least 8 characters' : 'Your password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={signup ? 'new-password' : 'current-password'}
              required
            />
          </div>
          <button className="btn primary" disabled={busy || !email || !password}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button>
          <p className="switch">
            {signup ? 'Already have an account? ' : 'New here? '}
            <a href="#" onClick={(e) => { e.preventDefault(); setError(''); setMode(signup ? 'login' : 'signup'); }}>
              {signup ? 'Sign in' : 'Create an account'}
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
