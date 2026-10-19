import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { createAuth } from './auth.js';

const STATUSES = ['open', 'in_progress', 'done'];
const DECISIONS = ['rejected', 'improve'];

function secretMatches(provided) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(config.callbackSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createApp(db, escalation) {
  const app = express();
  app.use(cors({ origin: config.frontendOrigin }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true, notifier: config.notifier }));

  const auth = createAuth();
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

  // The app has no login, so the whole workspace is one viaSocket user. Never change this id:
  // every connection and flow is isolated by it.
  const EMBED_USER = 'action-correction-workspace';
  app.get('/api/viasocket/token', (_req, res) => {
    const { orgId, projectId, embedSecret } = config.viasocket;
    if (!orgId || !projectId || !embedSecret) return res.status(503).json({ error: 'viaSocket is not configured: set VIASOCKET_ORG_ID, VIASOCKET_PROJECT_ID and VIASOCKET_EMBED_SECRET' });
    const token = jwt.sign({ org_id: orgId, project_id: projectId, unique_identifier: EMBED_USER }, embedSecret, { algorithm: 'HS256' });
    res.json({ token });
  });

  return app;
}
