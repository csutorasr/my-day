import { useDashboard } from '../dashboard.jsx';
import { NEXT, gates, humanFailing, latestLinks } from '../format.js';
import { Ref } from './Ref.jsx';

const LANES = [
  { key: 'you', title: 'Needs you', dot: 'warn', none: 'Nothing blocked on you' },
  { key: 'agent', title: 'Agent working', dot: 'accent', none: 'No agents running' },
  { key: 'wait', title: 'Waiting', dot: '', none: 'Nothing waiting' },
  { key: 'ready', title: 'Ready', dot: 'ok', none: 'Nothing ready yet' },
];

// Open MRs grouped by what each waits for. Shared with the overview tiles.
export function mrLanes(s) {
  const closed = new Set(s.closedStatuses);
  const asked = new Set(s.questions.filter((q) => q.item_id).map((q) => q.item_id));
  const mrs = s.items.filter((i) => i.type === 'mr' && !closed.has(i.status));
  const lanes = Object.fromEntries(LANES.map((l) => [l.key, { ...l, items: [] }]));
  for (const m of mrs) {
    if (m.agent_id) lanes.agent.items.push(m);
    else if (asked.has(m.id) || m.failed || m.status === 'blocked') lanes.you.items.push(m);
    else if (m.data?.verdict === 'merge') lanes.ready.items.push(m);
    else lanes.wait.items.push(m);
  }
  return { lanes, total: mrs.length };
}

function MrCard({ m }) {
  const { state: s } = useDashboard();
  const q = s.questions.find((x) => x.item_id === m.id);
  const ticket = m.data?.ticketKeys?.[0];
  const links = latestLinks(m);
  const nextText = q
    ? `Waiting for you · ${q.id}`
    : m.agent_id
      ? `Agent ${m.agent_id} working`
      : NEXT[m.data?.verdict] ?? (humanFailing(m.data?.failing ?? []) || 'Waiting');
  return (
    <div className="card">
      <div className="top">
        <Ref item={m} />
        {ticket && <span className="mono muted tiny">{ticket}</span>}
      </div>
      <div className="t">{m.title}</div>
      <div className="gates">
        {gates(m, s.loop.targetBranch).map(([text, tone]) => <span key={text} className={`g ${tone}`}>{text}</span>)}
      </div>
      {links.length > 0 && (
        <div className="links">
          {links.map((l) => <Ref key={l.kind} item={m} text={l.label ?? l.kind} url={l.url} actions={[]} />)}
        </div>
      )}
      <div className={`next${q ? ' warn' : ''}`}>{nextText}</div>
    </div>
  );
}

export function MrBoard() {
  const { state: s } = useDashboard();
  const board = s ? mrLanes(s) : null;
  return (
    <section className="section" id="mrs" aria-labelledby="h-mrs">
      <div className="section-head">
        <h2 id="h-mrs">My merge requests</h2>
        <span className="muted small">{board ? `${board.total} open · grouped by what they wait for` : ''}</span>
      </div>
      <div className="board">
        {board
          ? LANES.map(({ key }) => {
              const l = board.lanes[key];
              return (
                <div className="lane" key={key}>
                  <div className="title"><span className={`dot ${l.dot}`} />{l.title} <span className="n">{l.items.length}</span></div>
                  {l.items.length ? l.items.map((m) => <MrCard key={m.id} m={m} />) : <div className="none">{l.none}</div>}
                </div>
              );
            })
          : [0, 1].map((k) => <div className="lane" key={k}><span className="skel card-skel" /></div>)}
      </div>
    </section>
  );
}
