import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.SESSION_SECRET = 'secret-test';
process.env.DB_PATH = ':memory:';

const { openDb } = await import('./db.js');
const { createApp } = await import('./app.js');

const post = (url, body, headers = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('email signup limited to the allowed domain, and login gates /api', async () => {
  const server = createApp(openDb(':memory:'), {}).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    assert.equal((await fetch(`${base}/people`)).status, 401);
    assert.equal((await fetch(`${base}/health`)).status, 200);

    assert.equal((await post(`${base}/auth/signup`, { email: 'a@gmail.com', password: 'longenough1' })).status, 403);
    assert.equal((await post(`${base}/auth/signup`, { email: 'a@viasocket.com.evil.com', password: 'longenough1' })).status, 403);
    assert.equal((await post(`${base}/auth/signup`, { email: 'a@evil.com@viasocket.com', password: 'longenough1' })).status, 400);
    assert.equal((await post(`${base}/auth/signup`, { email: 'a@viasocket.com', password: 'short' })).status, 400);

    const up = await post(`${base}/auth/signup`, { email: 'Dev@ViaSocket.com', password: 'longenough1' });
    assert.equal(up.status, 200);
    assert.equal((await post(`${base}/auth/signup`, { email: 'dev@viasocket.com', password: 'longenough1' })).status, 409);
    const cookie = up.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/people`, { headers: { cookie } })).status, 200);

    assert.equal((await post(`${base}/auth/login`, { email: 'dev@viasocket.com', password: 'wrong-pass' })).status, 401);
    assert.equal((await post(`${base}/auth/login`, { email: 'nobody@viasocket.com', password: 'longenough1' })).status, 401);
    const ok = await post(`${base}/auth/login`, { email: 'dev@viasocket.com', password: 'longenough1' });
    assert.equal(ok.status, 200);
    const me = await (await fetch(`${base}/auth/me`, { headers: { cookie: ok.headers.get('set-cookie').split(';')[0] } })).json();
    assert.equal(me.email, 'dev@viasocket.com');

    assert.equal((await fetch(`${base}/viasocket/token`, { headers: { cookie } })).status, 503); // embed secret unset
    assert.equal((await post(`${base}/actions/1/status`, { status: 'done' }, { 'x-callback-secret': 'wrong' })).status, 401);
  } finally {
    server.close();
  }
});
