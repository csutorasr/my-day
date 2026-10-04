import { useDashboard } from '../dashboard.jsx';
import { Ref } from './Ref.jsx';

const detail = (i) => [i.branch, i.repos?.join(', '), i.attempts ? `attempts ${i.attempts}` : ''].filter(Boolean).join(' · ');

export function Tickets() {
  const { state: s } = useDashboard();
  const closed = new Set(s?.closedStatuses ?? []);
  const tickets = (s?.items ?? []).filter((i) => !['mr', 'review'].includes(i.type));
  const open = tickets.filter((i) => !closed.has(i.status));
  const done = tickets.filter((i) => closed.has(i.status));
  return (
    <section className="panel" aria-labelledby="h-tickets">
      <div className="head"><h2 id="h-tickets">Tickets</h2><span className="count">{open.length || ''}</span></div>
      <ul className="rows">
        {s && !open.length && <li className="empty">No open tickets in scope.</li>}
        {open.map((i) => (
          <li key={i.id}>
            <div className="main">
              <Ref item={i} />
              <span className="t">{i.title}</span>
              {detail(i) && <span className="muted small">{detail(i)}</span>}
            </div>
            <span className="status">{i.status}</span>
          </li>
        ))}
      </ul>
      {done.length > 0 && (
        <details className="closed">
          <summary className="muted">Closed ({done.length})</summary>
          <ul className="rows">
            {done.map((i) => (
              <li key={i.id}>
                <div className="main"><Ref item={i} actions={[]} /><span className="t">{i.title}</span></div>
                <span className="status">{i.status}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
