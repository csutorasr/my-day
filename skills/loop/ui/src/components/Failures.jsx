import { useDashboard } from '../dashboard.jsx';
import { Ref } from './Ref.jsx';

// Items the loop gave up on. Hidden when there are none.
export function Failures() {
  const { state: s } = useDashboard();
  if (!s?.failed.length) return null;
  return (
    <section className="panel" id="failures" aria-labelledby="h-failed">
      <div className="head"><h2 id="h-failed">Failures</h2><span className="count warn">{s.failed.length}</span></div>
      <ul className="rows">
        {s.failed.map((f) => (
          <li key={f.id}>
            <div className="main">
              <Ref item={f} />
              <span className="t">{f.title}</span>
              <span className="reason">{f.fail_reason}</span>
              {f.hint && <span className="muted small">{f.hint}</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
