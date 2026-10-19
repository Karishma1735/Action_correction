import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function ActionsPage() {
  const [actions, setActions] = useState([]);
  const [teams, setTeams] = useState([]);
  const [people, setPeople] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', team_id: '', assignee_id: '' });
  const [open, setOpen] = useState(null);
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
      setForm({ title: '', description: '', team_id: '', assignee_id: '' });
    });
  };

  const review = (action, decision) => {
    const feedback = window.prompt(decision === 'rejected' ? 'Why is it rejected?' : 'What needs to be improved?');
    if (feedback) run(() => api.review(action.id, { decision, feedback }));
  };

  return (
    <>
      <h2>New action</h2>
      <form onSubmit={create} className="row">
        <input required placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <select required value={form.team_id} onChange={(e) => setForm({ ...form, team_id: e.target.value })}>
          <option value="">Team</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select required value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}>
          <option value="">Assignee</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button>Create</button>
      </form>
      {error && <p className="error">{error}</p>}

      <h2>Actions</h2>
      <table>
        <thead><tr><th>Title</th><th>Team</th><th>Assignee</th><th>Review</th><th>Status</th><th>Priority</th><th /></tr></thead>
        <tbody>
          {actions.map((a) => (
            <tr key={a.id}>
              <td><a href="#" onClick={(e) => { e.preventDefault(); api.action(a.id).then(setOpen); }}>{a.title}</a></td>
              <td>{a.team_name}</td>
              <td>{a.assignee_name}</td>
              <td>{a.review}</td>
              <td>{a.status}</td>
              <td>{a.priority || '-'}</td>
              <td className="buttons">
                <button onClick={() => review(a, 'rejected')}>Reject</button>
                <button onClick={() => review(a, 'improve')}>Improve</button>
                <button disabled={a.status === 'done'} onClick={() => run(() => api.setStatus(a.id, 'done'))}>Done</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {open && (
        <section className="panel">
          <button className="close" onClick={() => setOpen(null)}>Close</button>
          <h3>{open.title}</h3>
          {open.ai_summary && <p><strong>Summary ({open.ai_source}):</strong> {open.ai_summary}</p>}
          <h4>Scheduled follow-ups</h4>
          <ul>{open.jobs.map((j) => <li key={j.id}>{j.type} at {j.run_at} UTC · {j.state}</li>)}</ul>
          <h4>History</h4>
          <ul>{open.events.map((ev) => <li key={ev.id}>{ev.created_at} · {ev.kind} {ev.detail && `· ${ev.detail}`}</li>)}</ul>
        </section>
      )}
    </>
  );
}
