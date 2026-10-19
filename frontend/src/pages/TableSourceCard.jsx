import { useEffect, useState } from 'react';
import { api } from '../api.js';

const MAPPING = [
  ['title', 'Action title', true],
  ['assignee', 'Assignee (email or name)', true],
  ['team', 'Team (name)', false],
  ['description', 'Description', false],
  ['priority', 'Priority (low, medium, high)', false],
];
const EMPTY = { table: '', table_name: '', columns: {}, default_team_id: '', create_missing: false, day_column: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };

export const when = (iso) => (iso ? new Date(iso).toLocaleString() : 'never');

export function SyncSummary({ sync }) {
  if (!sync) return <p className="muted" style={{ margin: 0 }}>Not synced yet.</p>;
  return (
    <>
      <p style={{ margin: '0 0 6px' }} className={sync.ok ? '' : 'error'}>
        {sync.ok
          ? `Last synced ${when(sync.at)}: ${sync.created} new, ${sync.updated} updated, ${sync.skipped.length} skipped (${sync.rows} rows in the table).`
          : `Last sync failed ${when(sync.at)}: ${sync.error}`}
      </p>
      {sync.skipped.length > 0 && (
        <details>
          <summary className="muted">Why were {sync.skipped.length} rows skipped?</summary>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{sync.skipped.slice(0, 20).map((s) => <li key={s}>{s}</li>)}</ul>
        </details>
      )}
    </>
  );
}

// Choose the viaSocket Table the actions come from and which column means what.
export default function TableSourceCard() {
  const [state, setState] = useState(null); // { config, lastSync, everyMinutes }
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [tables, setTables] = useState(null);
  const [columns, setColumns] = useState([]);
  const [teams, setTeams] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => api.tableSource().then(setState).catch((e) => setError(e.message));
  useEffect(() => { load(); api.teams().then(setTeams).catch(() => {}); }, []);

  async function startEditing() {
    const c = state?.config;
    setForm(c ? { table: c.table, table_name: c.table_name || '', columns: c.columns, default_team_id: c.default_team_id ? String(c.default_team_id) : '', create_missing: c.create_missing, day_column: c.day_filter?.column || '', timezone: c.day_filter?.timezone || EMPTY.timezone } : EMPTY);
    setEditing(true);
    setError('');
    try { setTables(await api.tableSourceTables()); } catch (e) { setTables([]); setError(e.message); }
    if (c) api.tableSourceColumns(c.table).then(setColumns).catch((e) => setError(e.message));
  }

  async function pickTable(value) {
    const t = tables.find((x) => String(x.value) === value);
    setForm({ ...form, table: value, table_name: t?.label || '', columns: {}, day_column: '' });
    setColumns([]);
    if (!value) return;
    try { setColumns(await api.tableSourceColumns(value)); } catch (e) { setError(e.message); }
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.saveTableSource({
        table: form.table,
        table_name: form.table_name,
        columns: form.columns,
        default_team_id: form.default_team_id ? Number(form.default_team_id) : null,
        create_missing: form.create_missing,
        day_filter: form.day_column ? { column: form.day_column, timezone: form.timezone } : null,
      });
      setState(await api.syncTableSource());
      setEditing(false);
    } catch (err) {
      setError(err.message);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setError('');
    try { setState(await api.syncTableSource()); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function stop() {
    setBusy(true);
    try { await api.stopTableSource(); await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const cfg = state?.config;
  const label = (key) => columns.find((c) => c.key === key)?.label || key;
  const options = (list) => list.filter((c) => c.type !== 'rowid').map((c) => <option key={c.key} value={c.key}>{c.label}</option>);

  return (
    <section className="card">
      <div className="card-head">
        <h3>Where actions come from</h3>
        {!editing && <button className="btn sm" onClick={startEditing}>{cfg ? 'Change' : 'Choose a viaSocket Table'}</button>}
      </div>
      {error && <p className="error">{error}</p>}

      {!editing && !cfg && <p className="muted" style={{ margin: 0 }}>Actions are added by hand. Choose a viaSocket Table to import them from it instead (connect viaSocket Table in the panel below first).</p>}

      {!editing && cfg && (
        <>
          <p style={{ margin: '0 0 10px' }}>
            Importing from <strong>{cfg.table_name || cfg.table}</strong> every {state.everyMinutes} minutes.
            {cfg.day_filter && <> Only rows whose date is today ({cfg.day_filter.timezone}).</>}
          </p>
          <SyncSummary sync={state.lastSync} />
          <div className="btn-row" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
            <button className="btn sm primary" disabled={busy} onClick={syncNow}>{busy ? 'Syncing…' : 'Sync now'}</button>
            <button className="btn sm danger" disabled={busy} onClick={stop}>Stop importing</button>
          </div>
        </>
      )}

      {editing && (
        <form onSubmit={save}>
          <div className="grid">
            <div className="field wide">
              <label htmlFor="srctable">Table</label>
              <select id="srctable" required value={form.table} onChange={(e) => pickTable(e.target.value)} disabled={!tables}>
                <option value="">{tables ? 'Select table' : 'Loading…'}</option>
                {tables?.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {form.table && columns.length > 0 && (
              <>
                {MAPPING.map(([key, name, required]) => (
                  <div className="field" key={key}>
                    <label htmlFor={`map-${key}`}>{name}{required ? '' : ' (optional)'}</label>
                    <select id={`map-${key}`} required={required && !(key === 'team')} value={form.columns[key] || ''} onChange={(e) => setForm({ ...form, columns: { ...form.columns, [key]: e.target.value } })}>
                      <option value="">{required ? 'Select column' : 'Not used'}</option>
                      {options(columns)}
                    </select>
                  </div>
                ))}
                <div className="field">
                  <label htmlFor="deft">Default team {form.columns.team ? '(when a row has none)' : ''}</label>
                  <select id="deft" required={!form.columns.team} value={form.default_team_id} onChange={(e) => setForm({ ...form, default_team_id: e.target.value })}>
                    <option value="">None</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="day">Only today's rows, by (optional)</label>
                  <select id="day" value={form.day_column} onChange={(e) => setForm({ ...form, day_column: e.target.value })}>
                    <option value="">Import all rows</option>
                    <option value="createdat">Created at</option>
                    {options(columns)}
                  </select>
                </div>
                {form.day_column && (
                  <div className="field">
                    <label htmlFor="tz">Timezone for “today”</label>
                    <input id="tz" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="e.g. Asia/Kolkata" />
                  </div>
                )}
                <div className="field wide">
                  <label><input type="checkbox" style={{ width: 'auto', marginRight: 8 }} checked={form.create_missing} onChange={(e) => setForm({ ...form, create_missing: e.target.checked })} />Create people and teams that a row names but the app doesn't have yet</label>
                  <span className="muted">Off: such rows are skipped and listed after each sync.</span>
                </div>
              </>
            )}
          </div>
          <div className="btn-row" style={{ justifyContent: 'flex-start', marginTop: 14 }}>
            <button className="btn primary" disabled={busy || !form.table || columns.length === 0}>{busy ? 'Saving…' : 'Save and sync now'}</button>
            <button type="button" className="btn" onClick={() => { setEditing(false); setError(''); }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
