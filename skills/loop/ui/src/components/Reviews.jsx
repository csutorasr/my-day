import { useDashboard } from '../dashboard.jsx';
import { label } from '../format.js';
import { Ref } from './Ref.jsx';

export function Reviews() {
  const { state: s, act } = useDashboard();
  return (
    <section className="panel" id="reviews" aria-labelledby="h-reviews">
      <div className="head"><h2 id="h-reviews">Reviews for you</h2><span className="count accent">{s?.reviews.length || ''}</span></div>
      <ul className="rows">
        {s && !s.reviews.length && <li className="empty">Nothing to review.</li>}
        {s?.reviews.map((r) => (
          <li key={r.id}>
            <div className="main"><Ref item={r} actions={[]} /><span className="t">{r.title}</span></div>
            <span className="btns">
              <button type="button" className="btn small" aria-label={`Mark ${label(r)} reviewed`} onClick={() => act(`/api/reviews/${r.id}/done`)}>Done</button>
              <button type="button" className="btn small ghost" aria-label={`Skip ${label(r)}`} onClick={() => act(`/api/reviews/${r.id}/skip`)}>Skip</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
