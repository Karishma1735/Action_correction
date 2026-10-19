import { useEffect, useState } from 'react';
import { api } from '../api.js';

const EMPTY_PERSON = { name: '', email: '' };
const EMPTY_TEAM = { name: '', lead_id: '', manager_id: '', channel: 'slack' };

export default function SetupPage() {
  const [people, setPeople] = useState([]);
  const [teams, setTeams] = useState([]);
  const [person, setPerson] = useState(EMPTY_PERSON);
  const [team, setTeam] = useState(EMPTY_TEAM);
  const [error, setError] = useState('');
  const [editingPerson, setEditingPerson] = useState(null); // person id being edited
  const [editingTeam, setEditingTeam] = useState(null); // team id being edited
  const [confirm, setConfirm] = useState(null); // { kind, item }

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
  const resetPerson = () => { setPerson(EMPTY_PERSON); setEditingPerson(null); };
  const resetTeam = () => { setTeam(EMPTY_TEAM); setEditingTeam(null); };
  const editPerson = (p) => { setEditingPerson(p.id); setPerson({ name: p.name, email: p.email || '' }); };
  const editTeam = (t) => {
    setEditingTeam(t.id);
    setTeam({ name: t.name, lead_id: t.lead_id ? String(t.lead_id) : '', manager_id: t.manager_id ? String(t.manager_id) : '', channel: t.channel });
  };
  const remove = async () => {
    const { kind, item } = confirm;
    setConfirm(null);
    setError('');
    try {
      await (kind === 'person' ? api.deletePerson : api.deleteTeam)(item.id);
      if (kind === 'person' && editingPerson === item.id) resetPerson();
      if (kind === 'team' && editingTeam === item.id) resetTeam();
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
          <div className="card-head"><h3>{editingPerson ? 'Edit person' : 'People'}</h3><span className="muted">{people.length}</span></div>
          <form onSubmit={submit((body) => (editingPerson ? api.updatePerson(editingPerson, body) : api.addPerson(body)), person, resetPerson)} className="grid" style={{ marginBottom: 12 }}>
            <div className="field wide"><label htmlFor="pname">Name</label><input id="pname" required value={person.name} onChange={setP('name')} /></div>
            <div className="field"><label htmlFor="pemail">Email</label><input id="pemail" type="email" value={person.email} onChange={setP('email')} /></div>
            <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
              <button className="btn primary">{editingPerson ? 'Save changes' : 'Add person'}</button>
              {editingPerson && <button type="button" className="btn" onClick={resetPerson}>Cancel</button>}
            </div>
          </form>
          {people.length === 0 ? <div className="empty"><strong>No people yet</strong>Add the first one above.</div> : people.map((p) => (
            <div className="person" key={p.id}>
              <div className="avatar">{initials(p.name)}</div>
              <div className="meta">
                <div>{p.name}</div>
                <div className="muted">{p.email || 'No contact details'}</div>
              </div>
              <div className="btn-row" style={{ marginLeft: 'auto' }}>
                <button className="btn sm" onClick={() => editPerson(p)}>Edit</button>
                <button className="btn sm danger" onClick={() => setConfirm({ kind: 'person', item: p })}>Delete</button>
              </div>
            </div>
          ))}
        </section>

        <section className="card">
          <div className="card-head"><h3>{editingTeam ? 'Edit team' : 'Teams'}</h3><span className="muted">{teams.length}</span></div>
          <form
            onSubmit={submit((body) => (editingTeam ? api.updateTeam(editingTeam, body) : api.addTeam(body)), { ...team, lead_id: Number(team.lead_id) || null, manager_id: Number(team.manager_id) || null }, resetTeam)}
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
            <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
              <button className="btn primary">{editingTeam ? 'Save changes' : 'Add team'}</button>
              {editingTeam && <button type="button" className="btn" onClick={resetTeam}>Cancel</button>}
            </div>
          </form>
          {teams.length === 0 ? <div className="empty"><strong>No teams yet</strong>Add the first one above.</div> : teams.map((t) => (
            <div className="person" key={t.id}>
              <div className="avatar">{initials(t.name)}</div>
              <div className="meta">
                <div>{t.name} <span className={`badge ${t.channel === 'slack' ? 'info' : ''}`}>{t.channel}</span></div>
                <div className="muted">Lead: {nameOf(t.lead_id)} · Manager: {nameOf(t.manager_id)}</div>
              </div>
              <div className="btn-row" style={{ marginLeft: 'auto' }}>
                <button className="btn sm" onClick={() => editTeam(t)}>Edit</button>
                <button className="btn sm danger" onClick={() => setConfirm({ kind: 'team', item: t })}>Delete</button>
              </div>
            </div>
          ))}
        </section>
      </div>

      {confirm && (
        <div className="overlay center" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete {confirm.kind === 'person' ? 'person' : 'team'}?</h3>
            <p className="muted">
              “{confirm.item.name}” will be removed.
              {confirm.kind === 'person' && ' They will also be cleared as lead or manager of any team.'}
            </p>
            <div className="btn-row">
              <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn primary" style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }} onClick={remove}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
