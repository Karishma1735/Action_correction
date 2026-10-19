import jwt from 'jsonwebtoken';
import { config } from './config.js';

// A "Mark as done" link in a notification. The signed token says which action it may close and who
// received it; it expires, and it can do nothing else.
const TTL = '14d';

export function doneUrl(actionId, personId) {
  const { sessionSecret } = config.auth;
  if (!sessionSecret) return null;
  const token = jwt.sign({ typ: 'done', a: actionId, p: personId }, sessionSecret, { algorithm: 'HS256', expiresIn: TTL });
  return `${config.publicUrl}/done/${token}`;
}

export function readDoneToken(token) {
  try {
    const claims = jwt.verify(token, config.auth.sessionSecret, { algorithms: ['HS256'] });
    return claims.typ === 'done' ? { actionId: claims.a, personId: claims.p } : null;
  } catch {
    return null;
  }
}
