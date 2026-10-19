import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

const COOKIE = 'ac_session';
const SESSION_HOURS = 12;
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60_000;

const same = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

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

export function createAuth() {
  const { password, sessionSecret } = config.auth;
  const configured = Boolean(password && sessionSecret);
  const attempts = new Map(); // ip -> { count, resetAt }

  const isSignedIn = (req) => {
    const token = readCookie(req, COOKIE);
    if (!configured || !token) return false;
    try {
      jwt.verify(token, sessionSecret, { algorithms: ['HS256'] });
      return true;
    } catch {
      return false;
    }
  };

  return {
    require(req, res, next) {
      if (!configured) return res.status(503).json({ error: 'Login is not configured: set APP_PASSWORD and SESSION_SECRET' });
      if (!isSignedIn(req)) return res.status(401).json({ error: 'Sign in required' });
      next();
    },
    login(req, res) {
      if (!configured) return res.status(503).json({ error: 'Login is not configured: set APP_PASSWORD and SESSION_SECRET' });
      const now = Date.now();
      const entry = attempts.get(req.ip);
      const tries = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + WINDOW_MS };
      if (tries.count >= MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many attempts, try again later' });
      if (!same(req.body?.password ?? '', password)) {
        attempts.set(req.ip, { ...tries, count: tries.count + 1 });
        return res.status(401).json({ error: 'Wrong password' });
      }
      attempts.delete(req.ip);
      const token = jwt.sign({ sub: 'workspace' }, sessionSecret, { algorithm: 'HS256', expiresIn: `${SESSION_HOURS}h` });
      res.setHeader('Set-Cookie', cookie(token, SESSION_HOURS * 3600));
      res.json({ ok: true });
    },
    logout(_req, res) {
      res.setHeader('Set-Cookie', cookie('', 0));
      res.json({ ok: true });
    },
    me(req, res) {
      res.json({ signedIn: isSignedIn(req), configured });
    },
  };
}
