import { config } from './config.js';
import { openDb } from './db.js';
import { createEscalation } from './escalation.js';
import { createApp } from './app.js';
import { createTableSource, tableSyncEveryMs } from './tableSource.js';

const db = openDb();
const escalation = createEscalation(db);
const tableSource = createTableSource(db);
const app = createApp(db, escalation, tableSource);

setInterval(() => escalation.tick().catch((err) => console.error('scheduler tick failed:', err)), config.tickSeconds * 1000);

// Pull actions from the chosen viaSocket Table on a timer (only when a table is chosen).
setInterval(() => {
  if (tableSource.getConfig()) tableSource.sync().catch((err) => console.error('table sync failed:', err));
}, tableSyncEveryMs());

app.listen(config.port, '0.0.0.0', () => console.log(`API on :${config.port} (notifier: ${config.notifier})`));
