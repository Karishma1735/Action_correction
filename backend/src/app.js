import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { createAuth } from './auth.js';
import { embedToken, findAuthId, SERVICES } from './viasocket/client.js';
import { viasocketNotifier } from './notifier/viasocket.js';

const STATUSES = ['open', 'in_progress', 'done'];
const DECISIONS = ['rejected', 'improve'];

function secretMatches(provided) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(config.callbackSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createApp(db, escalation) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors({ origin: config.frontendOrigin }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true, notifier: config.notifier }));

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
    const { name, email, slack_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const info = db.prepare('UPDATE people SET name = ?, email = ?, slack_id = ? WHERE id = ?').run(name, email || null, slack_id || null, req.params.id);
    if (!info.changes) return res.status(404).json({ error: 'not found' });
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
    try {
      const info = db
        .prepare('INSERT INTO actions (title, description, team_id, assignee_id) VALUES (?, ?, ?, ?)')
        .run(title, description ?? null, team_id, assignee_id);
      res.status(201).json(db.prepare('SELECT * FROM actions WHERE id = ?').get(info.lastInsertRowid));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
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
        subject: 'Test message from Action Correction',
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
