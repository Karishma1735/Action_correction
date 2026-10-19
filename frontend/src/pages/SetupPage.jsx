import { useEffect, useState } from 'react';
import { api } from '../api.js';

const EMPTY_PERSON = { name: '', email: '', slack_id: '' };
const EMPTY_TEAM = { name: '', lead_id: '', manager_id: '', channel: 'slack' };

export default function SetupPage() {
  const [people, setPeople] = useState([]);
  const [teams, setTeams] = useState([]);
  const [person, setPerson] = useState(EMPTY_PERSON);
  const [team, setTeam] = useState(EMPTY_TEAM);
  const [error, setError] = useState('');

  const load = () => Promise.all([api.people().then(setPeople), api.teams().then(setTeams)]).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const submit = (fn, body, reset) => async (e) => {
    e.preventDefault();
    setError('');
    try {
      await fn(body);
      reset();
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const nameOf = (id) => people.find((p) => p.id === id)?.name || 'Not set';
  const setP = (key) => (e) => setPerson({ ...person, [key]: e.target.value });
  const setT = (key) => (e) => setTeam({ ...team, [key]: e.target.value });
  const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <>
      <div className="page-head">
        <h2>People &amp; teams</h2>
        <p>Who gets notified: the assignee and team lead first, then the manager on escalation.</p>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="cols">
        <section className="card">
          <div className="card-head"><h3>People</h3><span className="muted">{people.length}</span></div>
          <form onSubmit={submit(api.addPerson, person, () => setPerson(EMPTY_PERSON))} className="grid" style={{ marginBottom: 12 }}>
            <div className="field wide"><label htmlFor="pname">Name</label><input id="pname" required value={person.name} onChange={setP('name')} /></div>
            <div className="field"><label htmlFor="pemail">Email</label><input id="pemail" type="email" value={person.email} onChange={setP('email')} /></div>
            <div className="field"><label htmlFor="pslack">Slack member ID (optional)</label><input id="pslack" placeholder="Found from email if empty" value={person.slack_id} onChange={setP('slack_id')} /></div>
            <button className="btn primary">Add person</button>
          </form>
          {people.length === 0 ? <div className="empty"><strong>No people yet</strong>Add the first one above.</div> : people.map((p) => (
            <div className="person" key={p.id}>
              <div className="avatar">{initials(p.name)}</div>
              <div className="meta">
                <div>{p.name}</div>
                <div className="muted">{[p.email, p.slack_id].filter(Boolean).join(' · ') || 'No contact details'}</div>
              </div>
            </div>
          ))}
        </section>

        <section className="card">
          <div className="card-head"><h3>Teams</h3><span className="muted">{teams.length}</span></div>
          <form
            onSubmit={submit(api.addTeam, { ...team, lead_id: Number(team.lead_id) || null, manager_id: Number(team.manager_id) || null }, () => setTeam(EMPTY_TEAM))}
            className="grid"
            style={{ marginBottom: 12 }}
          >
            <div className="field wide"><label htmlFor="tname">Team name</label><input id="tname" required value={team.name} onChange={setT('name')} /></div>
            <div className="field">
              <label htmlFor="tlead">Team lead</label>
              <select id="tlead" value={team.lead_id} onChange={setT('lead_id')}>
                <option value="">None</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="tmanager">Manager</label>
              <select id="tmanager" value={team.manager_id} onChange={setT('manager_id')}>
                <option value="">None</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="tchannel">Notify via</label>
              <select id="tchannel" value={team.channel} onChange={setT('channel')}>
                <option value="slack">Slack</option>
                <option value="email">Email</option>
              </select>
            </div>
            <button className="btn primary">Add team</button>
          </form>
          {teams.length === 0 ? <div className="empty"><strong>No teams yet</strong>Add the first one above.</div> : teams.map((t) => (
            <div className="person" key={t.id}>
              <div className="avatar">{initials(t.name)}</div>
              <div className="meta">
                <div>{t.name} <span className={`badge ${t.channel === 'slack' ? 'info' : ''}`}>{t.channel}</span></div>
                <div className="muted">Lead: {nameOf(t.lead_id)} · Manager: {nameOf(t.manager_id)}</div>
              </div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
