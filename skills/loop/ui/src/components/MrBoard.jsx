import { useState } from 'react';
import { useDashboard } from '../dashboard.jsx';
import { NEXT, humanFailing, latestLinks, pendingAnswers, plural } from '../format.js';
import { Gates } from './Gates.jsx';
import { Actions, Ref } from './Ref.jsx';

const LANES = [
  { key: 'you', title: 'Blocked on you', dot: 'warn', none: 'Nothing blocked on you' },
  { key: 'agent', title: 'Agent working', dot: 'accent', none: 'No agents running' },
  { key: 'wait', title: 'Waiting', dot: '', none: 'Nothing waiting' },
  { key: 'ready', title: 'Ready', dot: 'ok', none: 'Nothing ready yet' },
];

// Open MRs grouped by what each waits for. Shared with the status line.
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
  const { state: s, isQueued } = useDashboard();
  const q = s.questions.find((x) => x.item_id === m.id);
  const answered = pendingAnswers(s).get(m.id);
  const ticket = m.data?.ticketKeys?.[0];
  const links = latestLinks(m);
  // A decision taken on the dashboard stays visible on the card until the loop has acted on it.
  const nextText = q && isQueued(`q:${q.id}`)
    ? `Your answer to ${q.id} is being sent`
    : q
    ? `Waiting for you · ${q.id}`
    : answered
      ? `${answered.status === 'declined' ? 'Declined' : 'Answered'} ${answered.questionId} · the loop acts on it at the next check`
      : m.agent_id
      ? `Agent ${m.agent_id} working`
      : NEXT[m.data?.verdict] ?? (humanFailing(m.data?.failing ?? []) || 'Waiting');
  return (
    <li className="card">
      <div className="top">
        <Ref item={m} actions={[]} />
        {ticket && <span className="mono muted tiny">{ticket}</span>}
      </div>
      <div className="t">{m.title}</div>
      <Gates mr={m} target={s.loop.targetBranch} />
      {links.length > 0 && (
        <div className="links">
          {links.map((l) => <Ref key={l.kind} item={m} text={l.label ?? l.kind} url={l.url} actions={[]} />)}
        </div>
      )}
      <div className={`next${q ? ' warn' : answered ? ' ok' : ''}`}>
        <span>{nextText}</span>
        <span className="card-acts"><Actions item={m} /></span>
      </div>
    </li>
  );
}

// A lane shows its first few cards; the rest stay one click away so a busy lane never takes the page.
const LANE_CAP = 5;
function Lane({ l }) {
  const [all, setAll] = useState(false);
  const shown = all ? l.items : l.items.slice(0, LANE_CAP);
  return (
    <div className="lane">
      <h3 className="title" id={`lane-${l.key}`}><span className={`dot ${l.dot}`} aria-hidden="true" />{l.title} <span className="n">{l.items.length}</span></h3>
      {l.items.length ? (
        <ul className="cards" aria-labelledby={`lane-${l.key}`}>
          {shown.map((m) => <MrCard key={m.id} m={m} />)}
        </ul>
      ) : (
        <div className="none">{l.none}</div>
      )}
      {l.items.length > LANE_CAP && (
        <button type="button" className="btn small ghost more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show ${plural(l.items.length - LANE_CAP, 'more merge request')}`}
        </button>
      )}
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
          ? LANES.map(({ key }) => <Lane key={key} l={board.lanes[key]} />)
          : [0, 1].map((k) => <div className="lane" key={k}><span className="skel card-skel" /></div>)}
      </div>
    </section>
  );
}
