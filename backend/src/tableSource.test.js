import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.VIASOCKET_ORG_ID = '4160';
process.env.VIASOCKET_PROJECT_ID = 'projTest';
process.env.VIASOCKET_EMBED_SECRET = 'embed-secret';

const { openDb } = await import('./db.js');
const { createTableSource, dayOf } = await import('./tableSource.js');

// Fake viaSocket with one table. `rows` is what Get Table Rows answers; `calls` records its requests.
function fakeTable(rows, { connected = true } = {}) {
  const calls = [];
  const SERVICE = 'rowe71n93';
  globalThis.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    const json = (data) => ({ ok: true, status: 200, json: async () => data });
    if (url.endsWith('/embed/authentications')) return json({ success: true, data: connected ? [{ id: `a_${SERVICE}` }] : [] });
    if (url.includes('/integrations')) return json({ success: true, data: { flows: [{ id: 'scrTABLE', service_id: SERVICE, status: 'active' }] } });
    if (url.includes('/embed/list-options/')) return json({ success: true, data: [{ label: 'Tasks', value: 'tbl1' }] });
    if (url.includes('/func/')) {
      calls.push(body);
      if (body.action_version_id === 'rowtzrowrz8v') {
        return json({ todo: { fieldName: 'Task', fieldType: 'longtext' }, rowid: { fieldName: 'rowId', fieldType: 'rowid' }, who: { fieldName: 'Owner', fieldType: 'singleselect' } });
      }
      const offset = Number(body.inputData.queryopt.offset);
      return json(rows.slice(offset, offset + Number(body.inputData.queryopt.limit)));
    }
    throw new Error(`unexpected ${url}`);
  };
  return calls;
}

function setup() {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO people (name, email) VALUES ('Asha Rao', 'asha@viasocket.com')").run();
  db.prepare("INSERT INTO teams (name) VALUES ('Support')").run();
  const source = createTableSource(db);
  source.saveConfig({ table: 'tbl1', table_name: 'Tasks', columns: { title: 'todo', assignee: 'who', team: 'team', description: 'notes', priority: 'prio' }, create_missing: false });
  return { db, source };
}
const row = (id, o = {}) => ({ rowid: id, todo: `Task ${id}`, who: 'asha@viasocket.com', team: 'Support', notes: 'n', prio: 'High', ...o });

test('imports rows as actions, never twice, and updates a changed row', async () => {
  const rows = [row('r1'), row('r2', { who: 'Asha Rao', prio: 'weird' })];
  fakeTable(rows);
  const { db, source } = setup();
  const first = await source.sync();
  assert.deepEqual([first.ok, first.created, first.updated, first.skipped.length], [true, 2, 0, 0]);
  const a1 = db.prepare("SELECT * FROM actions WHERE source_row_id = 'r1'").get();
  assert.deepEqual([a1.title, a1.priority, a1.priority_manual, a1.review, a1.status], ['Task r1', 'high', 1, 'pending', 'open']);
  assert.equal(db.prepare("SELECT priority FROM actions WHERE source_row_id = 'r2'").get().priority, null); // unknown priority text

  const again = await source.sync();
  assert.deepEqual([again.created, again.updated], [0, 0]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM actions').get().n, 2);

  db.prepare("UPDATE actions SET review = 'rejected', status = 'done' WHERE source_row_id = 'r1'").run();
  rows[0].todo = 'Renamed';
  const changed = await source.sync();
  assert.equal(changed.updated, 1);
  const a = db.prepare("SELECT * FROM actions WHERE source_row_id = 'r1'").get();
  assert.deepEqual([a.title, a.review, a.status], ['Renamed', 'rejected', 'done']); // review and done are never touched
});

test('rows that cannot be matched are skipped with a reason, not created', async () => {
  fakeTable([row('r1', { who: 'Nobody' }), row('r2', { team: 'Ghosts' }), row('r3', { todo: '' }), { todo: 'No id', who: 'Asha Rao', team: 'Support' }]);
  const { db, source } = setup();
  const r = await source.sync();
  assert.equal(r.created, 0);
  assert.equal(r.skipped.length, 4);
  assert.match(r.skipped[0], /assignee "Nobody" is not in People/);
  assert.match(r.skipped[1], /team "Ghosts" does not exist/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM people').get().n, 1);
});

test('create_missing adds the people and teams a row names', async () => {
  fakeTable([row('r1', { who: 'new@viasocket.com', team: 'Brand New' })]);
  const { db, source } = setup();
  source.saveConfig({ ...source.getConfig(), create_missing: true });
  const r = await source.sync();
  assert.equal(r.created, 1);
  assert.equal(db.prepare("SELECT name FROM people WHERE email = 'new@viasocket.com'").get().name, 'new');
  assert.ok(db.prepare("SELECT 1 FROM teams WHERE name = 'Brand New'").get());
});

test('pages through large tables and applies the day filter', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = Array.from({ length: 450 }, (_, i) => row(`p${i}`, { day: i % 2 ? today : '2001-01-01' }));
  const calls = fakeTable(rows);
  const { db, source } = setup();
  assert.equal((await source.sync()).created, 450);
  assert.equal(calls.filter((c) => c.action_version_id === 'rowhk32rn3e0').length, 3); // 200 + 200 + 50
  db.exec('DELETE FROM events; DELETE FROM actions');
  source.saveConfig({ ...source.getConfig(), day_filter: { column: 'day', timezone: 'UTC' } });
  const filtered = await source.sync();
  assert.equal(filtered.created, 225, JSON.stringify({ ...filtered, skipped: filtered.skipped.slice(0, 2) }));
});

test('a failed sync is recorded, and bad settings are refused', async () => {
  fakeTable([], { connected: false });
  const { source } = setup();
  const r = await source.sync();
  assert.equal(r.ok, false);
  assert.match(r.error, /viaSocket Table is not connected/);
  assert.equal(source.lastSync().ok, false);
  assert.throws(() => source.saveConfig({ table: 'x', columns: { title: 'a' } }), /assignee/);
  assert.throws(() => source.saveConfig({ table: 'x', columns: { title: 'a', assignee: 'b' } }), /team column, or a default team/);
});

test('lists tables and columns for the pickers', async () => {
  fakeTable([]);
  const { source } = setup();
  assert.deepEqual(await source.listTables(), [{ label: 'Tasks', value: 'tbl1' }]);
  assert.deepEqual((await source.listColumns('tbl1')).map((c) => c.key), ['todo', 'rowid', 'who']);
});

test('dayOf reads dates in the chosen timezone', () => {
  assert.equal(dayOf('2026-10-19T22:30:00Z', 'Asia/Kolkata'), '2026-10-20');
  assert.equal(dayOf('2026-10-19T22:30:00Z', 'UTC'), '2026-10-19');
  assert.equal(dayOf('2026-10-19', 'Asia/Kolkata'), '2026-10-19');
  assert.equal(dayOf('nonsense', 'UTC'), null);
});
