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

test('edit and delete people and teams', async () => {
  const server = createApp(openDb(':memory:'), {}).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const up = await post(`${base}/auth/signup`, { email: 'dev@viasocket.com', password: 'longenough1' });
    const h = { cookie: up.headers.get('set-cookie').split(';')[0] };
    const send = (method, path, body) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...h }, body: body && JSON.stringify(body) });
    const asha = await (await send('POST', '/people', { name: 'Asha', email: 'a@viasocket.com' })).json();
    const ravi = await (await send('POST', '/people', { name: 'Ravi' })).json();
    const team = await (await send('POST', '/teams', { name: 'Support', lead_id: ravi.id, manager_id: ravi.id })).json();

    const edited = await (await send('PUT', `/people/${asha.id}`, { name: 'Asha Rao', email: 'asha@viasocket.com', slack_id: 'U0ASHA123' })).json();
    assert.equal(edited.name, 'Asha Rao');
    assert.equal((await send('PUT', `/people/${asha.id}`, { name: '' })).status, 400);
    assert.equal((await send('PUT', '/people/999', { name: 'x' })).status, 404);
    assert.equal((await send('PUT', `/teams/${team.id}`, { name: 'Support', channel: 'sms' })).status, 400);
    const t2 = await (await send('PUT', `/teams/${team.id}`, { name: 'Support EU', lead_id: asha.id, manager_id: null, channel: 'email' })).json();
    assert.deepEqual([t2.name, t2.lead_id, t2.manager_id, t2.channel], ['Support EU', asha.id, null, 'email']);

    await send('POST', '/actions', { title: 'A', team_id: team.id, assignee_id: asha.id });
    assert.equal((await send('DELETE', `/people/${asha.id}`)).status, 409); // has an action
    assert.equal((await send('DELETE', `/teams/${team.id}`)).status, 409); // has an action

    const created = await (await send('POST', '/actions', { title: 'P', team_id: team.id, assignee_id: asha.id, priority: 'high' })).json();
    assert.equal(created.priority, 'high');
    assert.equal((await send('POST', '/actions', { title: 'P', team_id: team.id, assignee_id: asha.id, priority: 'urgent' })).status, 400);
    const upd = await (await send('PUT', `/actions/${created.id}`, { title: 'P2', description: 'd', team_id: team.id, assignee_id: asha.id, priority: '' })).json();
    assert.deepEqual([upd.title, upd.description, upd.priority], ['P2', 'd', null]);
    assert.equal((await send('DELETE', `/actions/${created.id}`)).status, 204);

    // Reassigning frees the person; deleting the action frees the team.
    const act = (await (await send('GET', '/actions')).json())[0];
    assert.equal((await send('PUT', `/actions/${act.id}`, { title: 'A', team_id: team.id, assignee_id: ravi.id })).status, 200);
    assert.equal((await send('DELETE', `/people/${asha.id}`)).status, 204);
    assert.equal((await send('PUT', `/actions/${act.id}`, { title: 'A', team_id: team.id, assignee_id: 999 })).status, 400);
    assert.equal((await send('DELETE', `/actions/${act.id}`)).status, 204);
    assert.equal((await send('DELETE', `/teams/${team.id}`)).status, 204);
    assert.equal((await send('POST', '/people', { name: 'Ravi2' })).status, 201);
    assert.equal((await send('DELETE', `/people/${ravi.id}`)).status, 204);
    assert.equal((await (await send('GET', '/people')).json()).length, 1); // Ravi2
    assert.equal((await send('DELETE', '/people/999')).status, 404);
  } finally {
    server.close();
  }
});

test('done link marks the action done without a login, and only with a valid token', async () => {
  const db = openDb(':memory:');
  const server = createApp(db, (await import('./escalation.js')).createEscalation(db)).listen(0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { doneUrl } = await import('./doneLink.js');
  try {
    const p = db.prepare("INSERT INTO people (name) VALUES ('Asha')").run().lastInsertRowid;
    const t = db.prepare("INSERT INTO teams (name) VALUES ('Ops')").run().lastInsertRowid;
    const a = db.prepare("INSERT INTO actions (title, team_id, assignee_id) VALUES ('Fix <b>', ?, ?)").run(t, p).lastInsertRowid;
    const token = doneUrl(a, p).split('/done/')[1];

    const page = await fetch(`${origin}/done/${token}`); // a scanner only GETs: nothing changes
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Fix &lt;b&gt;/);
    assert.equal(db.prepare('SELECT status FROM actions WHERE id = ?').get(a).status, 'open');

    assert.equal((await fetch(`${origin}/done/${token}`, { method: 'POST' })).status, 200);
    assert.equal(db.prepare('SELECT status FROM actions WHERE id = ?').get(a).status, 'done');
    assert.equal((await fetch(`${origin}/done/${token}`, { method: 'POST' })).status, 200); // idempotent
    assert.ok(db.prepare("SELECT 1 FROM events WHERE action_id = ? AND kind = 'done_via_link'").get(a));

    assert.equal((await fetch(`${origin}/done/not-a-token`, { method: 'POST' })).status, 400);
    assert.equal((await fetch(`${origin}/api/people`)).status, 401); // the rest still needs a login
  } finally {
    server.close();
  }
});

test('metrics count each assignee and team by current review state; approve stops reminders', async () => {
  const db = openDb(':memory:');
  const { createEscalation } = await import('./escalation.js');
  const server = createApp(db, createEscalation(db)).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const up = await post(`${base}/auth/signup`, { email: 'dev@viasocket.com', password: 'longenough1' });
    const h = { cookie: up.headers.get('set-cookie').split(';')[0] };
    const send = (method, path, body) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...h }, body: body && JSON.stringify(body) });
    const [asha, ravi] = [await (await send('POST', '/people', { name: 'Asha' })).json(), await (await send('POST', '/people', { name: 'Ravi' })).json()];
    const t1 = await (await send('POST', '/teams', { name: 'Ops' })).json();
    const t2 = await (await send('POST', '/teams', { name: 'Empty' })).json();
    const mk = async (assignee) => (await (await send('POST', '/actions', { title: 'x', team_id: t1.id, assignee_id: assignee.id })).json()).id;
    const [a1, a2, a3, a4] = [await mk(asha), await mk(asha), await mk(asha), await mk(ravi)];
    await send('POST', `/actions/${a1}/review`, { decision: 'rejected', feedback: 'bad' });
    await send('POST', `/actions/${a2}/review`, { decision: 'improve', feedback: 'more' });
    assert.equal((await send('POST', `/actions/${a3}/approve`)).status, 200);
    await send('POST', `/actions/${a4}/status`, { status: 'done' });
    assert.equal((await send('POST', '/actions/999/approve')).status, 404);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE action_id = ? AND state = 'pending'").get(a3).n, 0);

    const m = await (await send('GET', '/metrics')).json();
    assert.deepEqual(m.totals, { total: 4, approved: 1, rejected: 1, improve: 1, pending: 1, done: 1 });
    const a = m.assignees.find((p) => p.name === 'Asha');
    assert.deepEqual([a.total, a.approved, a.rejected, a.improve, a.pending], [3, 1, 1, 1, 0]);
    assert.equal(m.teams.find((t) => t.name === 'Empty').total, 0);
    assert.equal((await fetch(`${base}/metrics`)).status, 401);
  } finally {
    server.close();
  }
});
