import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.APP_PASSWORD = 'pw-test';
process.env.SESSION_SECRET = 'secret-test';
process.env.DB_PATH = ':memory:';

const { openDb } = await import('./db.js');
const { createApp } = await import('./app.js');

test('login gates /api', async () => {
  const server = createApp(openDb(':memory:'), {}).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    assert.equal((await fetch(`${base}/people`)).status, 401);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const bad = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'x' }) });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'pw-test' }) });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/people`, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${base}/viasocket/token`, { headers: { cookie } })).status, 503); // signed in, embed secret unset
    assert.equal((await fetch(`${base}/actions/1/status`, { method: 'POST', headers: { 'x-callback-secret': 'wrong', 'content-type': 'application/json' }, body: '{"status":"done"}' })).status, 401);
  } finally {
    server.close();
  }
});
