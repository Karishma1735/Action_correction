import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

const COOKIE = 'ac_session';
const SESSION_HOURS = 12;
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60_000;
const MIN_PASSWORD = 8;
const NOT_CONFIGURED = 'Login is not configured: set SESSION_SECRET';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  const expected = Buffer.from(hash || '', 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(salt || '', 'hex'), 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Exactly one "@", a plain local part, and the allowed domain. Returns the lower-cased address or null.
export function normalizeEmail(raw) {
  const email = String(raw ?? '').trim().toLowerCase();
  return /^[a-z0-9._+-]+@[a-z0-9.-]+$/.test(email) ? email : null;
}

function readCookie(req, name) {
  for (const part of (req.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function cookie(value, maxAgeSeconds) {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (config.auth.secureCookie) flags.push('Secure');
  return `${COOKIE}=${encodeURIComponent(value)}; ${flags.join('; ')}`;
}

export function createAuth(db) {
  const { sessionSecret, allowedEmailDomain } = config.auth;
  const configured = Boolean(sessionSecret);
  const attempts = new Map(); // ip -> { count, resetAt }
  // Run on unknown emails too, so response time does not reveal which addresses have accounts.
  const dummyHash = hashPassword('not-a-real-password');

  const session = (req) => {
    const token = readCookie(req, COOKIE);
    if (!configured || !token) return null;
    try {
      return jwt.verify(token, sessionSecret, { algorithms: ['HS256'] });
    } catch {
      return null;
    }
  };

  const throttled = (req) => {
    const now = Date.now();
    const entry = attempts.get(req.ip);
    return entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS;
  };
  const fail = (req) => {
    const now = Date.now();
    const entry = attempts.get(req.ip);
    const cur = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + WINDOW_MS };
    attempts.set(req.ip, { ...cur, count: cur.count + 1 });
  };

  function startSession(res, user) {
    const token = jwt.sign({ sub: String(user.id), email: user.email }, sessionSecret, { algorithm: 'HS256', expiresIn: `${SESSION_HOURS}h` });
    res.setHeader('Set-Cookie', cookie(token, SESSION_HOURS * 3600));
    res.json({ email: user.email });
  }

  return {
    require(req, res, next) {
      if (!configured) return res.status(503).json({ error: NOT_CONFIGURED });
      if (!session(req)) return res.status(401).json({ error: 'Sign in required' });
      next();
    },
    signup(req, res) {
      if (!configured) return res.status(503).json({ error: NOT_CONFIGURED });
      if (throttled(req)) return res.status(429).json({ error: 'Too many attempts, try again later' });
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password ?? '');
      if (!email) return res.status(400).json({ error: 'Enter a valid email address' });
      if (!email.endsWith(`@${allowedEmailDomain}`)) {
        fail(req);
        return res.status(403).json({ error: `Only @${allowedEmailDomain} email addresses can sign up` });
      }
      if (password.length < MIN_PASSWORD) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
      const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hashPassword(password));
      startSession(res, { id: info.lastInsertRowid, email });
    },
    login(req, res) {
      if (!configured) return res.status(503).json({ error: NOT_CONFIGURED });
      if (throttled(req)) return res.status(429).json({ error: 'Too many attempts, try again later' });
      const email = normalizeEmail(req.body?.email);
      const user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
      const ok = verifyPassword(String(req.body?.password ?? ''), user ? user.password_hash : dummyHash);
      if (!user || !ok) {
        fail(req);
        return res.status(401).json({ error: 'Wrong email or password' });
      }
      attempts.delete(req.ip);
      startSession(res, user);
    },
    logout(_req, res) {
      res.setHeader('Set-Cookie', cookie('', 0));
      res.json({ ok: true });
    },
    me(req, res) {
      const s = session(req);
      res.json({ signedIn: Boolean(s), email: s?.email ?? null, configured, allowedEmailDomain });
    },
  };
}
