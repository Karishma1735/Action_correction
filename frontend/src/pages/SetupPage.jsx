import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function SetupPage() {
  const [people, setPeople] = useState([]);
  const [teams, setTeams] = useState([]);
  const [person, setPerson] = useState({ name: '', email: '', slack_id: '' });
  const [team, setTeam] = useState({ name: '', lead_id: '', manager_id: '', channel: 'slack' });
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
  const nameOf = (id) => people.find((p) => p.id === id)?.name || '-';

  return (
    <>
      <h2>People</h2>
      <form onSubmit={submit(api.addPerson, person, () => setPerson({ name: '', email: '', slack_id: '' }))} className="row">
        <input required placeholder="Name" value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} />
        <input placeholder="Email" value={person.email} onChange={(e) => setPerson({ ...person, email: e.target.value })} />
        <input placeholder="Slack member ID" value={person.slack_id} onChange={(e) => setPerson({ ...person, slack_id: e.target.value })} />
        <button>Add person</button>
      </form>
      <ul>{people.map((p) => <li key={p.id}>{p.name} {p.email && `· ${p.email}`} {p.slack_id && `· ${p.slack_id}`}</li>)}</ul>

      <h2>Teams</h2>
      <form
        onSubmit={submit(api.addTeam, { ...team, lead_id: Number(team.lead_id) || null, manager_id: Number(team.manager_id) || null },
          () => setTeam({ name: '', lead_id: '', manager_id: '', channel: 'slack' }))}
        className="row"
      >
        <input required placeholder="Team name" value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} />
        <select value={team.lead_id} onChange={(e) => setTeam({ ...team, lead_id: e.target.value })}>
          <option value="">Team lead</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={team.manager_id} onChange={(e) => setTeam({ ...team, manager_id: e.target.value })}>
          <option value="">Manager</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={team.channel} onChange={(e) => setTeam({ ...team, channel: e.target.value })}>
          <option value="slack">Slack</option>
          <option value="email">Email</option>
        </select>
        <button>Add team</button>
      </form>
      <ul>{teams.map((t) => <li key={t.id}>{t.name} · lead {nameOf(t.lead_id)} · manager {nameOf(t.manager_id)} · {t.channel}</li>)}</ul>
      {error && <p className="error">{error}</p>}
    </>
  );
}
