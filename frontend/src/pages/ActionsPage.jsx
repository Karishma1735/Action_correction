import { useEffect, useState } from 'react';
import { api } from '../api.js';

const STATUS = { open: ['Open', 'info'], in_progress: ['In progress', 'warn'], done: ['Done', 'ok'] };
const REVIEW = { pending: ['Pending', ''], rejected: ['Rejected', 'bad'], improve: ['Needs improvement', 'warn'] };
const PRIORITY = { high: 'bad', medium: 'warn', low: 'ok' };
const label = (map, key) => map[key] || [key, ''];
const EMPTY = { title: '', description: '', team_id: '', assignee_id: '' };

function Badge({ tone = '', children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
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

  const load = () =>
    Promise.all([api.actions().then(setActions), api.teams().then(setTeams), api.people().then(setPeople)]).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

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
    });
  };

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const needsSetup = teams.length === 0 || people.length === 0;

  return (
    <>
      <div className="page-head">
        <h2>Actions</h2>
        <p>Rejected or “improve” actions notify the assignee and lead, remind after 2 hours and escalate to the manager after 24.</p>
      </div>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <div className="card-head"><h3>New action</h3></div>
        {needsSetup && <p className="muted">Add at least one person and one team under “People &amp; teams” first.</p>}
        <form onSubmit={create} className="grid">
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" required placeholder="e.g. Update onboarding doc" value={form.title} onChange={set('title')} />
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
          <button className="btn primary" disabled={needsSetup}>Create action</button>
        </form>
      </section>

      <section className="card">
        <div className="card-head"><h3>All actions</h3><span className="muted">{actions.length} total</span></div>
        {actions.length === 0 ? (
          <div className="empty"><strong>No actions yet</strong>Create one above to get started.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Title</th><th>Team</th><th>Assignee</th><th>Review</th><th>Status</th><th>Priority</th><th /></tr></thead>
              <tbody>
                {actions.map((a) => {
                  const [reviewText, reviewTone] = label(REVIEW, a.review);
                  const [statusText, statusTone] = label(STATUS, a.status);
                  return (
                    <tr key={a.id}>
                      <td><button className="link" onClick={() => api.action(a.id).then(setOpen)}>{a.title}</button></td>
                      <td>{a.team_name}</td>
                      <td>{a.assignee_name}</td>
                      <td><Badge tone={reviewTone}>{reviewText}</Badge></td>
                      <td><Badge tone={statusTone}>{statusText}</Badge></td>
                      <td>{a.priority ? <Badge tone={PRIORITY[a.priority] || ''}>{a.priority}</Badge> : <span className="muted">–</span>}</td>
                      <td>
                        <div className="btn-row">
                          <button className="btn sm danger" onClick={() => setDialog({ action: a, decision: 'rejected' })}>Reject</button>
                          <button className="btn sm" onClick={() => setDialog({ action: a, decision: 'improve' })}>Improve</button>
                          <button className="btn sm success" disabled={a.status === 'done'} onClick={() => run(() => api.setStatus(a.id, 'done'))}>Done</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
            {open.description && <p className="muted">{open.description}</p>}
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
