import { useEffect, useState } from 'react';
import { getJson } from '../api.js';
import { useDashboard } from '../dashboard.jsx';
import { dotFor, hhmm } from '../format.js';
import { Ref } from './Ref.jsx';

// Event log for a day range; reloads whenever the state changes (SSE) or the range does.
export function Activity() {
  const { state: s } = useDashboard();
  const [range, setRange] = useState({ today: '1' });
  const [pressed, setPressed] = useState('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [events, setEvents] = useState(null);

  useEffect(() => {
    if (!s) return;
    let stale = false;
    getJson('/api/summary?' + new URLSearchParams(range))
      .then((sum) => { if (!stale) setEvents(sum.events.filter((e) => e.kind !== 'created').reverse()); })
      .catch(() => {});
    return () => { stale = true; };
  }, [s, range]);

  const pick = (key, r) => { setPressed(key); setRange(r); };
  const apply = () => {
    const r = {};
    if (from) r.from = from;
    if (to) r.to = to;
    pick('apply', r);
  };
  const byId = new Map((s?.items ?? []).map((i) => [i.id, i]));

  return (
    <section className="panel" aria-labelledby="h-activity">
      <div className="head">
        <h2 id="h-activity">Activity</h2><span className="grow" />
        <div className="ranges">
          <button className="pill" type="button" aria-pressed={pressed === 'today'} onClick={() => pick('today', { today: '1' })}>Today</button>
          <button className="pill" type="button" aria-pressed={pressed === 'yesterday'} onClick={() => pick('yesterday', { yesterday: '1' })}>Yesterday</button>
          <label className="muted small">from <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="muted small">to <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="pill" type="button" aria-pressed={pressed === 'apply'} onClick={apply}>Apply</button>
        </div>
      </div>
      <div className="body flush">
        {events && !events.length && <div className="muted">No activity in this range.</div>}
        {events?.map((e) => {
          const item = e.item_id ? byId.get(e.item_id) : null;
          return (
            <div className="ev" key={e.id}>
              <span className="time">{hhmm(e.ts)}</span>
              <span className={`dot ${dotFor(e.kind)}`} />
              <div className="main">
                <span className="msg">{e.message}</span>
                <span className="muted tiny">
                  {e.kind}{item || e.item_id ? ' · ' : ''}{item ? <Ref item={item} actions={[]} /> : e.item_id ?? ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
