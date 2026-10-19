import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { SyncSummary } from './TableSourceCard.jsx';

const STATUS = { open: ['Open', 'info'], in_progress: ['In progress', 'warn'], done: ['Done', 'ok'] };
const REVIEW = { pending: ['Pending', ''], approved: ['Approved', 'ok'], rejected: ['Rejected', 'bad'], improve: ['Needs improvement', 'warn'] };
const PRIORITY = { high: 'bad', medium: 'warn', low: 'ok' };
const label = (map, key) => map[key] || [key, ''];
const PAGE_SIZE = 20;
const TABS = [['all', 'All'], ['pending', 'Pending'], ['improve', 'Needs improvement'], ['rejected', 'Rejected'], ['approved', 'Approved']];
const EMPTY = { title: '', description: '', team_id: '', assignee_id: '', priority: '' };
const PRIORITY_OPTIONS = [['', 'Auto (AI rates it)'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];

function Badge({ tone = '', children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function ManageAction({ action, teams, people, onSave, onDelete }) {
  const initial = {
    title: action.title,
    description: action.description || '',
    priority: action.priority || '',
    team_id: String(action.team_id),
    assignee_id: String(action.assignee_id),
  };
  const [f, setF] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const set = (key) => (e) => setF({ ...f, [key]: e.target.value });
  const changed = Object.keys(initial).some((k) => f[k] !== initial[k]);
  return (
    <>
      <h4 className="section-title">Edit action</h4>
      <div className="grid">
        <div className="field wide">
          <label htmlFor="mtitle">Title</label>
          <input id="mtitle" value={f.title} onChange={set('title')} />
        </div>
        <div className="field wide">
          <label htmlFor="mdesc">Description</label>
          <textarea id="mdesc" value={f.description} onChange={set('description')} />
        </div>
        <div className="field">
          <label htmlFor="mpriority">Priority</label>
          <select id="mpriority" value={f.priority} onChange={set('priority')}>
            {PRIORITY_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="mteam">Team</label>
          <select id="mteam" value={f.team_id} onChange={set('team_id')}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="field wide">
          <label htmlFor="massignee">Assignee</label>
          <select id="massignee" value={f.assignee_id} onChange={set('assignee_id')}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.email ? ` (${p.email})` : ''}</option>)}
          </select>
        </div>
      </div>
      <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
        {confirming ? (
          <span className="btn-row">
            <button className="btn sm" onClick={() => setConfirming(false)}>Keep</button>
            <button className="btn sm danger" onClick={onDelete}>Yes, delete this action</button>
          </span>
        ) : (
          <button className="btn sm danger" onClick={() => setConfirming(true)}>Delete action</button>
        )}
        <button
          className="btn sm primary"
          disabled={!changed || !f.title.trim()}
          onClick={() => onSave({ ...f, title: f.title.trim(), team_id: Number(f.team_id), assignee_id: Number(f.assignee_id) })}
        >
          Save changes
        </button>
      </div>
    </>
  );
}

function ReviewDialog({ action, decision, onCancel, onSubmit }) {
  const [feedback, setFeedback] = useState('');
  const rejected = decision === 'rejected';
  return (
    <div className="overlay center" onClick={onCancel}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSubmit(feedback.trim()); }}
      >
        <h3>{rejected ? 'Reject action' : 'Request improvement'}</h3>
        <p className="muted">“{action.title}”. The assignee and team lead will be notified.</p>
        <div className="field">
          <label htmlFor="feedback">{rejected ? 'Why is it rejected?' : 'What needs to be improved?'}</label>
          <textarea id="feedback" value={feedback} onChange={(e) => setFeedback(e.target.value)} autoFocus required />
        </div>
        <div className="btn-row">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!feedback.trim()}>{rejected ? 'Reject' : 'Send for improvement'}</button>
        </div>
      </form>
    </div>
  );
}

export default function ActionsPage() {
  const [actions, setActions] = useState([]);
  const [teams, setTeams] = useState([]);
  const [people, setPeople] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState('');
  const [source, setSource] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [f, setFilters] = useState({ tab: 'all', q: '', team: '', assignee: '', priority: '', page: 1 });

  const load = () =>
    Promise.all([api.actions().then(setActions), api.teams().then(setTeams), api.people().then(setPeople), api.tableSource().then(setSource)]).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  // Pick up changes made elsewhere, e.g. someone pressing "Mark as done" in Slack or email.
  const openId = open?.id;
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      load();
      if (openId) api.action(openId).then((a) => setOpen((cur) => (cur && cur.id === a.id ? a : cur))).catch(() => {});
    }, 10_000);
    return () => clearInterval(id);
  }, [openId]);

  const run = async (fn) => {
    setError('');
    try {
      await fn();
      await load();
      if (open) setOpen(await api.action(open.id));
    } catch (err) {
      setError(err.message);
    }
  };

  const create = (e) => {
    e.preventDefault();
    run(async () => {
      await api.addAction({ ...form, team_id: Number(form.team_id), assignee_id: Number(form.assignee_id) });
      setForm(EMPTY);
      setShowForm(false);
    });
  };

  const syncNow = async () => {
    setSyncing(true);
    setError('');
    try { setSource(await api.syncTableSource()); await load(); } catch (err) { setError(err.message); } finally { setSyncing(false); }
  };
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const needsSetup = teams.length === 0 || people.length === 0;

  const filter = (patch) => setFilters((cur) => ({ ...cur, page: 1, ...patch }));
  const q = f.q.trim().toLowerCase();
  const matches = (a, ignoreTab) =>
    (ignoreTab || f.tab === 'all' || a.review === f.tab) &&
    (!f.team || String(a.team_id) === f.team) &&
    (!f.assignee || String(a.assignee_id) === f.assignee) &&
    (!f.priority || (f.priority === 'none' ? !a.priority : a.priority === f.priority)) &&
    (!q || `${a.title} ${a.assignee_name} ${a.team_name}`.toLowerCase().includes(q));
  const filtered = actions.filter((a) => matches(a, false));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(f.page, pages);
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const count = (tab) => actions.filter((a) => matches(a, true) && (tab === 'all' || a.review === tab)).length;
  const filtering = f.tab !== 'all' || f.q || f.team || f.assignee || f.priority;

  return (
    <>
      <div className="page-head page-head-row">
        <div>
          <h2>Actions</h2>
          <p>Rejected or “improve” actions notify the assignee and lead, remind after 2 hours and escalate to the manager after 24.</p>
        </div>
        {!source?.config && <button className="btn primary" onClick={() => setShowForm(!showForm)}>{showForm ? 'Close' : '+ New action'}</button>}
      </div>
      {error && <p className="error">{error}</p>}

      {source?.config && (
        <section className="banner">
          <div className="banner-main">
            <strong>Imported from “{source.config.table_name || source.config.table}”</strong>
            <span className="muted">refreshes every {source.everyMinutes} min</span>
            <button className="btn sm primary" disabled={syncing} onClick={syncNow}>{syncing ? 'Syncing…' : 'Sync now'}</button>
          </div>
          <SyncSummary sync={source.lastSync} />
        </section>
      )}

      {!source?.config && showForm && (
        <section className="card">
          {needsSetup && <p className="muted">Add at least one person and one team under “People &amp; teams” first.</p>}
          <form onSubmit={create} className="grid">
            <div className="field">
              <label htmlFor="title">Title</label>
              <input id="title" required autoFocus placeholder="e.g. Update onboarding doc" value={form.title} onChange={set('title')} />
            </div>
            <div className="field">
              <label htmlFor="description">Description</label>
              <input id="description" placeholder="Optional" value={form.description} onChange={set('description')} />
            </div>
            <div className="field">
              <label htmlFor="team">Team</label>
              <select id="team" required value={form.team_id} onChange={set('team_id')}>
                <option value="">Select team</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="assignee">Assignee</label>
              <select id="assignee" required value={form.assignee_id} onChange={set('assignee_id')}>
                <option value="">Select person</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="priority">Priority</label>
              <select id="priority" value={form.priority} onChange={set('priority')}>
                {PRIORITY_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            </div>
            <button className="btn primary" disabled={needsSetup}>Create action</button>
          </form>
        </section>
      )}

      <section className="card list-card">
        <div className="seg" role="tablist">
          {TABS.map(([key, text]) => (
            <button key={key} role="tab" aria-selected={f.tab === key} className={f.tab === key ? 'on' : ''} onClick={() => filter({ tab: key })}>
              {text} <span className="count">{count(key)}</span>
            </button>
          ))}
        </div>
        <div className="toolbar">
          <input type="search" placeholder="Search title, person or team…" value={f.q} onChange={(e) => filter({ q: e.target.value })} aria-label="Search actions" />
          <select value={f.team} onChange={(e) => filter({ team: e.target.value })} aria-label="Team">
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={f.assignee} onChange={(e) => filter({ assignee: e.target.value })} aria-label="Assignee">
            <option value="">All assignees</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={f.priority} onChange={(e) => filter({ priority: e.target.value })} aria-label="Priority">
            <option value="">Any priority</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="none">No priority</option>
          </select>
          {filtering && <button className="btn sm" onClick={() => setFilters({ tab: 'all', q: '', team: '', assignee: '', priority: '', page: 1 })}>Clear</button>}
        </div>

        {actions.length === 0 ? (
          <div className="empty"><strong>No actions yet</strong>{source?.config ? 'Press “Sync now” to import from the table.' : 'Use “+ New action” to add one.'}</div>
        ) : filtered.length === 0 ? (
          <div className="empty"><strong>No actions match</strong>Try a different search or clear the filters.</div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="actions-table">
                <thead><tr><th>Action</th><th>Review</th><th>Status</th><th>Priority</th><th /></tr></thead>
                <tbody>
                  {visible.map((a) => {
                    const [reviewText, reviewTone] = label(REVIEW, a.review);
                    const [statusText, statusTone] = label(STATUS, a.status);
                    return (
                      <tr key={a.id}>
                        <td className="title-cell">
                          <button className="link" onClick={() => api.action(a.id).then(setOpen)}>{a.title}</button>
                          <div className="meta">{a.team_name} · {a.assignee_name}</div>
                        </td>
                        <td><Badge tone={reviewTone}>{reviewText}</Badge></td>
                        <td><Badge tone={statusTone}>{statusText}</Badge></td>
                        <td>{a.priority ? <Badge tone={PRIORITY[a.priority] || ''}>{a.priority}</Badge> : <span className="muted">–</span>}</td>
                        <td className="nowrap">
                          <div className="btn-row nowrap">
                            <button className="btn sm success" disabled={a.review === 'approved'} onClick={() => run(() => api.approve(a.id))}>Approve</button>
                            <button className="btn sm danger" onClick={() => setDialog({ action: a, decision: 'rejected' })}>Reject</button>
                            <button className="btn sm" onClick={() => setDialog({ action: a, decision: 'improve' })}>Improve</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span className="muted">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}{filtered.length !== actions.length ? ` (${actions.length} total)` : ''}</span>
              <div className="btn-row">
                <button className="btn sm" disabled={page <= 1} onClick={() => setFilters({ ...f, page: page - 1 })}>Previous</button>
                <span className="muted pager-now">Page {page} of {pages}</span>
                <button className="btn sm" disabled={page >= pages} onClick={() => setFilters({ ...f, page: page + 1 })}>Next</button>
              </div>
            </div>
          </>
        )}
      </section>

      {dialog && (
        <ReviewDialog
          {...dialog}
          onCancel={() => setDialog(null)}
          onSubmit={(feedback) => {
            const { action, decision } = dialog;
            setDialog(null);
            run(() => api.review(action.id, { decision, feedback }));
          }}
        />
      )}

      {open && (
        <div className="overlay" onClick={() => setOpen(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="card-head">
              <h3>{open.title}</h3>
              <button className="btn sm" onClick={() => setOpen(null)}>Close</button>
            </div>
            <div className="chips">
              <Badge tone={label(STATUS, open.status)[1]}>{label(STATUS, open.status)[0]}</Badge>
              <Badge tone={label(REVIEW, open.review)[1]}>{label(REVIEW, open.review)[0]}</Badge>
              {open.priority && <Badge tone={PRIORITY[open.priority] || ''}>{open.priority} priority</Badge>}
            </div>
            {/^https?:\/\//.test(open.description || '') && <p style={{ margin: '12px 0 0' }}><a href={open.description} target="_blank" rel="noreferrer">Open the linked page ↗</a></p>}
            <ManageAction
              key={`${open.id}-${open.updated_at}`}
              action={open}
              teams={teams}
              people={people}
              onSave={(change) => run(() => api.updateAction(open.id, change))}
              onDelete={async () => {
                const id = open.id;
                setOpen(null);
                try { await api.deleteAction(id); await load(); } catch (err) { setError(err.message); }
              }}
            />
            {open.feedback && <p><strong>Feedback:</strong> {open.feedback}</p>}
            {open.ai_summary && <div className="summary"><strong>AI summary ({open.ai_source}):</strong> {open.ai_summary}</div>}

            <h4 className="section-title">Scheduled follow-ups</h4>
            {open.jobs.length === 0 ? <p className="muted">None.</p> : (
              <ul className="timeline">
                {open.jobs.map((j) => (
                  <li key={j.id}><time>{j.run_at} UTC</time>{j.type} · <Badge tone={j.state === 'pending' ? 'info' : j.state === 'cancelled' ? '' : 'ok'}>{j.state}</Badge></li>
                ))}
              </ul>
            )}

            <h4 className="section-title">History</h4>
            {open.events.length === 0 ? <p className="muted">Nothing yet.</p> : (
              <ul className="timeline">
                {open.events.map((ev) => <li key={ev.id}><time>{ev.created_at} UTC</time>{ev.kind}{ev.detail && ` · ${ev.detail}`}</li>)}
              </ul>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
