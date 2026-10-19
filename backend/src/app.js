import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { createAuth } from './auth.js';
import { readDoneToken } from './doneLink.js';
import { embedToken, findAuthId, SERVICES } from './viasocket/client.js';
import { viasocketNotifier } from './notifier/viasocket.js';

const STATUSES = ['open', 'in_progress', 'done'];
const DECISIONS = ['rejected', 'improve'];
const PRIORITIES = ['low', 'medium', 'high'];
const priorityOf = (v) => (v === '' || v == null ? null : PRIORITIES.includes(v) ? v : undefined);


const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const donePage = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plug Informatrix</title>
<style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f6fa;color:#171a22}main{background:#fff;border:1px solid #e3e6ee;border-radius:12px;padding:32px;max-width:420px;text-align:center}button{font:inherit;font-weight:600;background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:10px 18px;cursor:pointer}.ok{color:#067647}.bad{color:#b42318}</style></head><body><main>${body}</main></body></html>`;

function secretMatches(provided) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(config.callbackSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createApp(db, escalation, tableSource) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors({ origin: config.frontendOrigin }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true, notifier: config.notifier }));

  // "Mark as done" link from a notification. The signed token is the credential, so no login is needed.
  // The page confirms with a POST from script so link scanners that only fetch the URL change nothing.
  app.get('/done/:token', (req, res) => {
    const claims = readDoneToken(req.params.token);
    if (!claims) return res.status(400).send(donePage('<h2 class="bad">This link is not valid or has expired.</h2><p>Open the app to mark the action as done.</p>'));
    const action = db.prepare('SELECT title, status FROM actions WHERE id = ?').get(claims.actionId);
    if (!action) return res.status(404).send(donePage('<h2 class="bad">This action no longer exists.</h2>'));
    res.send(donePage(`<h2 id="t">Marking “${escapeHtml(action.title)}” as done…</h2><p id="m"></p><button id="b" hidden>Mark as done</button>
<script>
const url = location.pathname;
async function go() {
  const t = document.getElementById('t'), m = document.getElementById('m'), b = document.getElementById('b');
  try {
    const r = await fetch(url, { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    t.className = 'ok'; t.textContent = '✓ Marked as done'; m.textContent = 'You can close this tab.'; b.hidden = true;
  } catch (e) { t.className = 'bad'; t.textContent = 'Could not mark it as done'; m.textContent = e.message; b.hidden = false; }
}
document.getElementById('b').onclick = go;
go();
</script>`));
  });
  app.post('/done/:token', (req, res) => {
    const claims = readDoneToken(req.params.token);
    if (!claims) return res.status(400).json({ error: 'This link is not valid or has expired.' });
    const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(claims.actionId);
    if (!action) return res.status(404).json({ error: 'This action no longer exists.' });
    if (action.status !== 'done') {
      escalation.setStatus(action.id, 'done');
      const who = db.prepare('SELECT name FROM people WHERE id = ?').get(claims.personId)?.name ?? 'someone';
      db.prepare('INSERT INTO events (action_id, kind, detail) VALUES (?, ?, ?)').run(action.id, 'done_via_link', `marked done by ${who} from a notification`);
    }
    res.json({ ok: true, title: action.title });
  });

  const auth = createAuth(db);
  app.post('/api/auth/signup', auth.signup);
  app.post('/api/auth/login', auth.login);
  app.post('/api/auth/logout', auth.logout);
  app.get('/api/auth/me', auth.me);
  // Callbacks from Slack/viaSocket carry X-Callback-Secret, which the status route checks itself.
  app.use('/api', (req, res, next) => (req.get('x-callback-secret') !== undefined ? next() : auth.require(req, res, next)));

  app.get('/api/people', (_req, res) => res.json(db.prepare('SELECT * FROM people ORDER BY name').all()));
  app.post('/api/people', (req, res) => {
    const { name, email, slack_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const info = db.prepare('INSERT INTO people (name, email, slack_id) VALUES (?, ?, ?)').run(name, email ?? null, slack_id ?? null);
    res.status(201).json(db.prepare('SELECT * FROM people WHERE id = ?').get(info.lastInsertRowid));
  });

  app.put('/api/people/:id', (req, res) => {
    const { name, email } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const before = db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'not found' });
    // The Slack member id is found from the email, so a changed email clears the saved one to be found again.
    const slackId = (email || null) === before.email ? before.slack_id : null;
    db.prepare('UPDATE people SET name = ?, email = ?, slack_id = ? WHERE id = ?').run(name, email || null, slackId, before.id);
    res.json(db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id));
  });
  app.delete('/api/people/:id', (req, res) => {
    const { id } = req.params;
    if (!db.prepare('SELECT 1 FROM people WHERE id = ?').get(id)) return res.status(404).json({ error: 'not found' });
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM actions WHERE assignee_id = ?').get(id);
    if (n) return res.status(409).json({ error: `Can't delete: assigned to ${n} action${n > 1 ? 's' : ''}. Reassign or finish them first.` });
    db.transaction(() => {
      db.prepare('UPDATE teams SET lead_id = NULL WHERE lead_id = ?').run(id);
      db.prepare('UPDATE teams SET manager_id = NULL WHERE manager_id = ?').run(id);
      db.prepare('DELETE FROM people WHERE id = ?').run(id);
    })();
    res.status(204).end();
  });

  app.get('/api/teams', (_req, res) => res.json(db.prepare('SELECT * FROM teams ORDER BY name').all()));
  app.post('/api/teams', (req, res) => {
    const { name, lead_id, manager_id, channel = 'slack' } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!['slack', 'email'].includes(channel)) return res.status(400).json({ error: 'channel must be slack or email' });
    const info = db
      .prepare('INSERT INTO teams (name, lead_id, manager_id, channel) VALUES (?, ?, ?, ?)')
      .run(name, lead_id ?? null, manager_id ?? null, channel);
    res.status(201).json(db.prepare('SELECT * FROM teams WHERE id = ?').get(info.lastInsertRowid));
  });

  app.put('/api/teams/:id', (req, res) => {
    const { name, lead_id, manager_id, channel = 'slack' } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!['slack', 'email'].includes(channel)) return res.status(400).json({ error: 'channel must be slack or email' });
    const info = db.prepare('UPDATE teams SET name = ?, lead_id = ?, manager_id = ?, channel = ? WHERE id = ?').run(name, lead_id ?? null, manager_id ?? null, channel, req.params.id);
    if (!info.changes) return res.status(404).json({ error: 'not found' });
    res.json(db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id));
  });
  app.delete('/api/teams/:id', (req, res) => {
    const { id } = req.params;
    if (!db.prepare('SELECT 1 FROM teams WHERE id = ?').get(id)) return res.status(404).json({ error: 'not found' });
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM actions WHERE team_id = ?').get(id);
    if (n) return res.status(409).json({ error: `Can't delete: ${n} action${n > 1 ? 's' : ''} belong to this team.` });
    db.prepare('DELETE FROM teams WHERE id = ?').run(id);
    res.status(204).end();
  });

  app.get('/api/actions', (_req, res) =>
    res.json(
      db
        .prepare(
          `SELECT a.*, p.name AS assignee_name, t.name AS team_name FROM actions a
           JOIN people p ON p.id = a.assignee_id JOIN teams t ON t.id = a.team_id
           ORDER BY a.id DESC`,
        )
        .all(),
    ),
  );
  app.post('/api/actions', (req, res) => {
    const { title, description, team_id, assignee_id } = req.body;
    if (!title || !team_id || !assignee_id) return res.status(400).json({ error: 'title, team_id and assignee_id are required' });
    const priority = priorityOf(req.body.priority);
    if (priority === undefined) return res.status(400).json({ error: `priority must be one of ${PRIORITIES.join(', ')}` });
    try {
      const info = db
        .prepare('INSERT INTO actions (title, description, team_id, assignee_id, priority, priority_manual) VALUES (?, ?, ?, ?, ?, ?)')
        .run(title, description ?? null, team_id, assignee_id, priority, priority ? 1 : 0);
      res.status(201).json(db.prepare('SELECT * FROM actions WHERE id = ?').get(info.lastInsertRowid));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.put('/api/actions/:id', (req, res) => {
    const { title, description, team_id, assignee_id } = req.body;
    if (!title || !team_id || !assignee_id) return res.status(400).json({ error: 'title, team_id and assignee_id are required' });
    const priority = priorityOf(req.body.priority);
    if (priority === undefined) return res.status(400).json({ error: `priority must be one of ${PRIORITIES.join(', ')}` });
    if (!db.prepare('SELECT 1 FROM teams WHERE id = ?').get(team_id)) return res.status(400).json({ error: 'team not found' });
    if (!db.prepare('SELECT 1 FROM people WHERE id = ?').get(assignee_id)) return res.status(400).json({ error: 'person not found' });
    const before = db.prepare('SELECT * FROM actions WHERE id = ?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'not found' });
    db.prepare("UPDATE actions SET title = ?, description = ?, team_id = ?, assignee_id = ?, priority = ?, priority_manual = ?, updated_at = datetime('now') WHERE id = ?").run(title, description || null, team_id, assignee_id, priority, priority ? (priority !== before.priority ? 1 : before.priority_manual) : 0, before.id);
    if (before.assignee_id !== assignee_id) {
      const name = db.prepare('SELECT name FROM people WHERE id = ?').get(assignee_id).name;
      db.prepare('INSERT INTO events (action_id, kind, detail) VALUES (?, ?, ?)').run(before.id, 'reassigned', `assignee -> ${name}`);
    }
    res.json(db.prepare('SELECT * FROM actions WHERE id = ?').get(before.id));
  });
  app.delete('/api/actions/:id', (req, res) => {
    const { id } = req.params;
    if (!db.prepare('SELECT 1 FROM actions WHERE id = ?').get(id)) return res.status(404).json({ error: 'not found' });
    db.transaction(() => {
      db.prepare('DELETE FROM jobs WHERE action_id = ?').run(id);
      db.prepare('DELETE FROM events WHERE action_id = ?').run(id);
      db.prepare('DELETE FROM actions WHERE id = ?').run(id);
    })();
    res.status(204).end();
  });
  app.get('/api/actions/:id', (req, res) => {
    const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(req.params.id);
    if (!action) return res.status(404).json({ error: 'not found' });
    const events = db.prepare('SELECT * FROM events WHERE action_id = ? ORDER BY id').all(action.id);
    const jobs = db.prepare('SELECT * FROM jobs WHERE action_id = ? ORDER BY id').all(action.id);
    res.json({ ...action, events, jobs });
  });

  app.post('/api/actions/:id/review', async (req, res) => {
    const { decision, feedback } = req.body;
    if (!DECISIONS.includes(decision)) return res.status(400).json({ error: `decision must be one of ${DECISIONS.join(', ')}` });
    if (!feedback) return res.status(400).json({ error: 'feedback is required' });
    const action = await escalation.review(Number(req.params.id), decision, feedback);
    if (!action) return res.status(404).json({ error: 'not found' });
    res.json(action);
  });

  app.post('/api/actions/:id/approve', (req, res) => {
    const action = escalation.approve(Number(req.params.id));
    if (!action) return res.status(404).json({ error: 'not found' });
    res.json(action);
  });

  // Counts per assignee and per team, by each action's current review state.
  app.get('/api/metrics', (_req, res) => {
    const counts = (idCol, table) =>
      db
        .prepare(
          `SELECT t.id, t.name,
             COUNT(a.id) AS total,
             COALESCE(SUM(a.review = 'approved'), 0) AS approved,
             COALESCE(SUM(a.review = 'rejected'), 0) AS rejected,
             COALESCE(SUM(a.review = 'improve'), 0) AS improve,
             COALESCE(SUM(a.review = 'pending'), 0) AS pending,
             COALESCE(SUM(a.status = 'done'), 0) AS done
           FROM ${table} t LEFT JOIN actions a ON a.${idCol} = t.id
           GROUP BY t.id ORDER BY total DESC, t.name`,
        )
        .all();
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(review = 'approved'), 0) AS approved,
           COALESCE(SUM(review = 'rejected'), 0) AS rejected,
           COALESCE(SUM(review = 'improve'), 0) AS improve,
           COALESCE(SUM(review = 'pending'), 0) AS pending,
           COALESCE(SUM(status = 'done'), 0) AS done
         FROM actions`,
      )
      .get();
    res.json({ totals, assignees: counts('assignee_id', 'people'), teams: counts('team_id', 'teams') });
  });

  // Used by the UI and by Slack/viaSocket callbacks. Callbacks must send X-Callback-Secret.
  app.post('/api/actions/:id/status', (req, res) => {
    const fromCallback = req.get('x-callback-secret') !== undefined;
    if (fromCallback && !secretMatches(req.get('x-callback-secret'))) return res.status(401).json({ error: 'bad secret' });
    const { status } = req.body;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
    const action = escalation.setStatus(Number(req.params.id), status);
    if (!action) return res.status(404).json({ error: 'not found' });
    res.json(action);
  });

  app.get('/api/integrations/status', (_req, res) =>
    res.json({
      notifier: config.notifier,
      viasocketConfigured: Boolean(config.viasocket.embedSecret),
      orgId: config.viasocket.orgId,
      projectId: config.viasocket.projectId,
    }),
  );

  app.get('/api/viasocket/token', (_req, res) => {
    try {
      res.json({ token: embedToken() });
    } catch (err) {
      res.status(503).json({ error: err.message });
    }
  });

  // Which of the apps used for delivery are connected right now (asked of viaSocket, not remembered).
  app.get('/api/integrations/connections', async (_req, res) => {
    try {
      const entries = await Promise.all(Object.entries(SERVICES).map(async ([name, id]) => [name, Boolean(await findAuthId(id))]));
      res.json(Object.fromEntries(entries));
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // Where actions come from: a viaSocket Table, pulled on a timer and on demand.
  const tableSourceStatus = () => ({ config: tableSource.getConfig(), lastSync: tableSource.lastSync(), everyMinutes: config.tableSyncMinutes });
  app.get('/api/table-source', (_req, res) => res.json(tableSourceStatus()));
  app.get('/api/table-source/tables', async (_req, res) => {
    try { res.json(await tableSource.listTables()); } catch (err) { res.status(502).json({ error: err.message }); }
  });
  app.get('/api/table-source/columns', async (req, res) => {
    if (!req.query.table) return res.status(400).json({ error: 'table is required' });
    try { res.json(await tableSource.listColumns(String(req.query.table))); } catch (err) { res.status(502).json({ error: err.message }); }
  });
  app.put('/api/table-source', (req, res) => {
    try { tableSource.saveConfig(req.body); res.json(tableSourceStatus()); } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.delete('/api/table-source', (_req, res) => { tableSource.clearConfig(); res.status(204).end(); });
  app.post('/api/table-source/sync', async (_req, res) => {
    if (!tableSource.getConfig()) return res.status(400).json({ error: 'Choose a table first' });
    await tableSource.sync();
    res.json(tableSourceStatus());
  });

  // Sends one real message through viaSocket so a connection can be proven from the UI.
  app.post('/api/integrations/test', async (req, res) => {
    const { person_id, channel } = req.body;
    if (!['slack', 'email'].includes(channel)) return res.status(400).json({ error: 'channel must be slack or email' });
    const person = db.prepare('SELECT * FROM people WHERE id = ?').get(person_id);
    if (!person) return res.status(404).json({ error: 'person not found' });
    try {
      await viasocketNotifier.send({
        channel,
        to: person,
        subject: 'Test message from Plug Informatrix',
        text: 'If you can read this, reminders and escalations will reach you.',
        rememberSlackId: (id) => db.prepare('UPDATE people SET slack_id = ? WHERE id = ?').run(id, person.id),
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // One-service deploy: serve the built frontend (cd frontend && npm run build) from the backend.
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  return app;
}
