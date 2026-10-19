import 'dotenv/config';
import path from 'node:path';

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  port: num(process.env.PORT, 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  dbPath: process.env.DB_PATH || (process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'app.db') : './data.db'),
  remindAfterMinutes: num(process.env.REMIND_AFTER_MINUTES, 120),
  escalateAfterMinutes: num(process.env.ESCALATE_AFTER_MINUTES, 1440),
  tickSeconds: num(process.env.SCHEDULER_TICK_SECONDS, 30),
  notifier: process.env.NOTIFIER || 'log',
  viasocket: {
    orgId: process.env.VIASOCKET_ORG_ID,
    projectId: process.env.VIASOCKET_PROJECT_ID,
    embedSecret: process.env.VIASOCKET_EMBED_SECRET,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },
  auth: {
    allowedEmailDomain: (process.env.ALLOWED_EMAIL_DOMAIN || 'viasocket.com').toLowerCase(),
    sessionSecret: process.env.SESSION_SECRET,
    secureCookie: process.env.NODE_ENV === 'production',
  },
  callbackSecret: process.env.CALLBACK_SECRET || 'change-me',
};
