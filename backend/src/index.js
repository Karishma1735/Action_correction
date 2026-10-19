import { config } from './config.js';
import { openDb } from './db.js';
import { createEscalation } from './escalation.js';
import { createApp } from './app.js';

const db = openDb();
const escalation = createEscalation(db);
const app = createApp(db, escalation);

setInterval(() => escalation.tick().catch((err) => console.error('scheduler tick failed:', err)), config.tickSeconds * 1000);

app.listen(config.port, () => console.log(`API on :${config.port} (notifier: ${config.notifier})`));
