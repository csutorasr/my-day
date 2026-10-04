import { useEffect, useState } from 'react';
import { getJson } from '../api.js';
import { useDashboard } from '../dashboard.jsx';
import { dotFor, eventLabel, hhmm } from '../format.js';
import { Ref } from './Ref.jsx';

const SHOWN = 30;

// Event log for a day range; reloads whenever the state changes (SSE) or the range does.
// Picking a date applies it at once; clearing both dates goes back to today.
export function Activity() {
  const { state: s } = useDashboard();
  const [preset, setPreset] = useState('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [all, setAll] = useState(false);
  const [events, setEvents] = useState(null);

  const range = from || to ? Object.fromEntries([['from', from], ['to', to]].filter(([, v]) => v)) : { [preset]: '1' };
  const key = JSON.stringify(range);

  useEffect(() => {
    if (!s) return undefined;
    let stale = false;
    getJson('/api/summary?' + new URLSearchParams(JSON.parse(key)))
      .then((sum) => { if (!stale) setEvents(sum.events.filter((e) => e.kind !== 'created').reverse()); })
      .catch(() => {});
    return () => { stale = true; };
  }, [s, key]);

  const pick = (p) => { setPreset(p); setFrom(''); setTo(''); setAll(false); };
  const byId = new Map((s?.items ?? []).map((i) => [i.id, i]));
  const custom = !!(from || to);
  const shown = all ? events : events?.slice(0, SHOWN);

  return (
    <section className="panel" aria-labelledby="h-activity">
      <div className="head">
        <h2 id="h-activity">Activity</h2><span className="grow" />
        <div className="ranges">
          <button className="pill" type="button" aria-pressed={!custom && preset === 'today'} onClick={() => pick('today')}>Today</button>
          <button className="pill" type="button" aria-pressed={!custom && preset === 'yesterday'} onClick={() => pick('yesterday')}>Yesterday</button>
          <label className={`muted small range${custom ? ' on' : ''}`}>From <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setAll(false); }} /></label>
          <label className={`muted small range${custom ? ' on' : ''}`}>to <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setAll(false); }} /></label>
        </div>
      </div>
      <div className="body flush">
        {events && !events.length && <div className="muted">No activity in this range.</div>}
        {shown?.map((e) => {
          const item = e.item_id ? byId.get(e.item_id) : null;
          return (
            <div className="ev" key={e.id}>
              <span className="time">{hhmm(e.ts)}</span>
              <span className={`dot ${dotFor(e.kind)}`} aria-hidden="true" />
              <div className="main">
                <span className="msg">{e.message}</span>
                <span className="muted tiny">
                  {eventLabel(e.kind)}{item || e.item_id ? ' · ' : ''}{item ? <Ref item={item} actions={[]} /> : e.item_id ?? ''}
                </span>
              </div>
            </div>
          );
        })}
        {events?.length > SHOWN && (
          <button type="button" className="btn small ghost more" onClick={() => setAll(!all)}>
            {all ? 'Show the latest only' : `Show all ${events.length} events`}
          </button>
        )}
      </div>
    </section>
  );
}
