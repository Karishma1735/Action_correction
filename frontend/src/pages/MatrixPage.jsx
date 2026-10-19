import { useEffect, useState } from 'react';
import { api } from '../api.js';

const Bar = ({ row }) => {
  const parts = [['seg-ok', row.approved, 'Approved'], ['seg-warn', row.improve, 'Improve'], ['seg-bad', row.rejected, 'Rejected'], ['seg-none', row.pending, 'Pending']];
  return (
    <div className="stack" role="img" aria-label={parts.map(([, n, l]) => `${l} ${n}`).join(', ')}>
      {row.total > 0 && parts.map(([cls, n, label]) => n > 0 && <i key={label} className={cls} style={{ width: `${(n / row.total) * 100}%` }} title={`${label}: ${n}`} />)}
    </div>
  );
};

function Table({ title, rows, nameLabel }) {
  return (
    <section className="card">
      <div className="card-head"><h3>{title}</h3><span className="muted">{rows.length}</span></div>
      {rows.length === 0 ? <div className="empty"><strong>Nothing here yet</strong></div> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{nameLabel}</th><th className="n">Total</th><th className="n">Approved</th><th className="n">Rejected</th><th className="n">Improve</th><th className="n">Pending</th><th className="n">Done</th><th>Mix</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong></td>
                  <td className="n">{r.total}</td>
                  <td className="n">{r.approved}</td>
                  <td className="n">{r.rejected}</td>
                  <td className="n">{r.improve}</td>
                  <td className="n">{r.pending}</td>
                  <td className="n">{r.done}</td>
                  <td><Bar row={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function MatrixPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => api.metrics().then(setData).catch((e) => setError(e.message));
    load();
    const id = setInterval(() => !document.hidden && load(), 15_000);
    return () => clearInterval(id);
  }, []);

  const t = data?.totals;
  return (
    <>
      <div className="page-head">
        <h2>Matrix</h2>
        <p>How each assignee and team is doing. Every action counts once, by its current review state.</p>
      </div>
      {error && <p className="error">{error}</p>}
      {t && (
        <div className="tiles">
          <div className="tile"><div className="num">{t.total}</div><div className="lbl">Total actions</div></div>
          <div className="tile ok"><div className="num">{t.approved}</div><div className="lbl">Approved</div></div>
          <div className="tile bad"><div className="num">{t.rejected}</div><div className="lbl">Rejected</div></div>
          <div className="tile warn"><div className="num">{t.improve}</div><div className="lbl">Needs improvement</div></div>
          <div className="tile"><div className="num">{t.pending}</div><div className="lbl">Pending review</div></div>
          <div className="tile ok"><div className="num">{t.done}</div><div className="lbl">Done</div></div>
        </div>
      )}
      <div className="legend"><span className="ok">Approved</span><span className="warn">Improve</span><span className="bad">Rejected</span><span className="none">Pending</span></div>
      {data && (
        <>
          <Table title="By assignee" rows={data.assignees} nameLabel="Assignee" />
          <Table title="By team" rows={data.teams} nameLabel="Team" />
        </>
      )}
    </>
  );
}
