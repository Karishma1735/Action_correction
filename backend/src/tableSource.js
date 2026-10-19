import { config } from './config.js';
import { listOptions, runAction } from './viasocket/client.js';

// viaSocket Table action versions, from the app's viaSocket document.
const LIST_COLUMNS = 'rowtzrowrz8v'; // List Table Columns (also the cheapest source of the `table` picker)
const GET_ROWS = 'rowhk32rn3e0'; // Get Table Rows

const PAGE = 200;
const MAX_PAGES = 25;
const PRIORITIES = ['low', 'medium', 'high'];
const FIELDS = ['title', 'description', 'assignee', 'team', 'priority'];

const text = (v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(', ');
  if (typeof v === 'object') return text(v.name ?? v.label ?? v.email ?? v.value ?? '');
  return String(v).trim();
};

// Get Table Rows answers with the rows in an array, possibly under a key, or a single row object.
function toRows(result) {
  if (Array.isArray(result)) return result;
  for (const key of ['rows', 'records', 'data', 'items']) if (Array.isArray(result?.[key])) return result[key];
  return result && typeof result === 'object' && result.rowid ? [result] : [];
}

// Calendar date (YYYY-MM-DD) of a value in a timezone; date-only strings are taken as they are.
export function dayOf(value, timeZone) {
  const s = value instanceof Date ? '' : text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = value instanceof Date ? value : new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const weekday = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
};
const shiftDay = (day, delta) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};

// The calendar day whose rows are imported today. daysBack 0 is today itself; 1 is the previous
// working day: yesterday, unless that is an off day, then the day before it, and so on.
export function targetDay(now, { timezone, days_back: daysBack = 0, off_days: offDays = [] }) {
  let day = dayOf(now, timezone);
  for (let i = 0; i < daysBack; i += 1) {
    do day = shiftDay(day, -1); while (offDays.includes(weekday(day)) && offDays.length < 7);
  }
  return day;
}

export function createTableSource(db) {
  const getSetting = (key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
  };
  const setSetting = (key, value) =>
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));

  const getConfig = () => getSetting('table_source');

  function validate(input) {
    const c = input ?? {};
    if (!c.table) throw new Error('Choose a table');
    const columns = c.columns ?? {};
    if (!columns.title) throw new Error('Choose the column that holds the action title');
    if (!columns.assignee) throw new Error('Choose the column that holds the assignee');
    if (!columns.team && !c.default_team_id) throw new Error('Choose a team column, or a default team');
    if (c.default_team_id && !db.prepare('SELECT 1 FROM teams WHERE id = ?').get(c.default_team_id)) throw new Error('Default team not found');
    const df = c.day_filter;
    if (df?.column && !df.timezone) throw new Error('Choose a timezone for the day filter');
    if (df?.column && (!Number.isInteger(df.days_back ?? 0) || df.days_back < 0 || df.days_back > 7)) throw new Error('days_back must be 0 to 7');
    if (df?.column && df.off_days && !(Array.isArray(df.off_days) && df.off_days.every((n) => Number.isInteger(n) && n >= 0 && n <= 6))) throw new Error('off_days must be weekday numbers 0 to 6');
    if (df?.column && (df.off_days ?? []).length >= 7) throw new Error('Not every day of the week can be an off day');
    return {
      table: String(c.table),
      table_name: c.table_name ? String(c.table_name) : null,
      columns: Object.fromEntries(FIELDS.map((f) => [f, columns[f] || null])),
      default_team_id: c.default_team_id ? Number(c.default_team_id) : null,
      create_missing: Boolean(c.create_missing),
      day_filter: df?.column
        ? { column: String(df.column), timezone: String(df.timezone), days_back: df.days_back ?? 0, off_days: [...new Set(df.off_days ?? [])].sort() }
        : null,
    };
  }

  const saveConfig = (input) => {
    const clean = validate(input);
    setSetting('table_source', clean);
    return clean;
  };
  const clearConfig = () => db.prepare("DELETE FROM settings WHERE key IN ('table_source', 'table_sync')").run();

  async function listTables() {
    return listOptions('table', LIST_COLUMNS, 'table', {});
  }

  // Columns of a table as [{ key, label, type }].
  async function listColumns(table) {
    const result = await runAction('table', LIST_COLUMNS, { table });
    return Object.entries(result ?? {})
      .filter(([, meta]) => meta && typeof meta === 'object' && meta.fieldType)
      .map(([key, meta]) => ({ key, label: meta.fieldName || key, type: meta.fieldType }));
  }

  async function fetchRows(table) {
    const rows = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await runAction('table', GET_ROWS, {
        table,
        filter_mode: 'list_all',
        queryopt: { limit: String(PAGE), offset: String(page * PAGE) },
      });
      const batch = toRows(result);
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
    return rows;
  }

  function findPerson(value, create) {
    const email = value.includes('@') ? value.toLowerCase() : null;
    const person = (email && db.prepare('SELECT * FROM people WHERE lower(email) = ?').get(email)) || db.prepare('SELECT * FROM people WHERE lower(name) = ?').get(value.toLowerCase());
    if (person || !create) return person ?? null;
    const name = email ? email.split('@')[0] : value;
    const id = db.prepare('INSERT INTO people (name, email) VALUES (?, ?)').run(name, email).lastInsertRowid;
    return db.prepare('SELECT * FROM people WHERE id = ?').get(id);
  }

  function findTeam(value, create) {
    const team = db.prepare('SELECT * FROM teams WHERE lower(name) = ?').get(value.toLowerCase());
    if (team || !create) return team ?? null;
    const id = db.prepare('INSERT INTO teams (name) VALUES (?)').run(value).lastInsertRowid;
    return db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
  }

  // Pulls the table's rows into actions. A row is matched by its row id, so running it again updates
  // instead of duplicating. Review state and done status are never touched by an import.
  async function sync() {
    const cfg = getConfig();
    if (!cfg) throw new Error('No table is selected');
    const result = { at: new Date().toISOString(), ok: true, error: null, rows: 0, matched: 0, target_day: null, created: 0, updated: 0, skipped: [] };
    try {
      let rows = await fetchRows(cfg.table);
      result.rows = rows.length;
      if (cfg.day_filter) {
        result.target_day = targetDay(new Date(), cfg.day_filter);
        rows = rows.filter((r) => dayOf(r[cfg.day_filter.column], cfg.day_filter.timezone) === result.target_day);
      }
      result.matched = rows.length;
      const col = cfg.columns;
      for (const row of rows) {
        const rowId = text(row.rowid);
        const label = rowId || '(no row id)';
        const title = text(row[col.title]);
        if (!rowId) { result.skipped.push(`${label}: the row has no id`); continue; }
        if (!title) { result.skipped.push(`${rowId}: empty title`); continue; }
        const assigneeName = text(row[col.assignee]);
        const assignee = assigneeName ? findPerson(assigneeName, cfg.create_missing) : null;
        if (!assignee) { result.skipped.push(`${title}: assignee "${assigneeName || '(empty)'}" is not in People`); continue; }
        const teamName = col.team ? text(row[col.team]) : '';
        const team = teamName ? findTeam(teamName, cfg.create_missing) : cfg.default_team_id ? db.prepare('SELECT * FROM teams WHERE id = ?').get(cfg.default_team_id) : null;
        if (!team) { result.skipped.push(`${title}: team "${teamName || '(empty)'}" does not exist`); continue; }
        const description = col.description ? text(row[col.description]) || null : null;
        const p = col.priority ? text(row[col.priority]).toLowerCase() : '';
        const priority = PRIORITIES.includes(p) ? p : null;

        const existing = db.prepare('SELECT * FROM actions WHERE source_row_id = ?').get(rowId);
        if (!existing) {
          const id = db
            .prepare('INSERT INTO actions (title, description, team_id, assignee_id, priority, priority_manual, source_row_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(title, description, team.id, assignee.id, priority, priority ? 1 : 0, rowId).lastInsertRowid;
          db.prepare('INSERT INTO events (action_id, kind, detail) VALUES (?, ?, ?)').run(id, 'imported', `from table "${cfg.table_name || cfg.table}"`);
          result.created += 1;
        } else {
          const next = { title, description, team_id: team.id, assignee_id: assignee.id, priority: col.priority ? priority : existing.priority };
          const changed = Object.keys(next).some((k) => next[k] !== existing[k]);
          if (changed) {
            db.prepare("UPDATE actions SET title = ?, description = ?, team_id = ?, assignee_id = ?, priority = ?, priority_manual = ?, updated_at = datetime('now') WHERE id = ?")
              .run(next.title, next.description, next.team_id, next.assignee_id, next.priority, col.priority && priority ? 1 : existing.priority_manual, existing.id);
            if (existing.assignee_id !== assignee.id) db.prepare('INSERT INTO events (action_id, kind, detail) VALUES (?, ?, ?)').run(existing.id, 'reassigned', `assignee -> ${assignee.name} (from the table)`);
            result.updated += 1;
          }
        }
      }
    } catch (err) {
      result.ok = false;
      result.error = err.message;
    }
    setSetting('table_sync', result);
    return result;
  }

  return { getConfig, saveConfig, clearConfig, listTables, listColumns, sync, lastSync: () => getSetting('table_sync') };
}

export const tableSyncEveryMs = () => config.tableSyncMinutes * 60_000;
