import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { toneDot } from '@/lib/tone';
import { useDashboard } from '../dashboard.jsx';
import { useLoopView } from '../loop.jsx';
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
  const loop = useLoopView();
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
    <li>
      <Card size="sm" className="gap-2 py-3">
        <div className="flex items-center justify-between gap-2 px-3">
          <Ref item={m} actions={[]} />
          {ticket && <span className="font-mono text-xs text-muted-foreground">{ticket}</span>}
        </div>
        <div className="px-3 text-sm font-medium">{m.title}</div>
        <div className="px-3"><Gates mr={m} target={s.loop.targetBranch} /></div>
        {links.length > 0 && (
          <div className="flex flex-wrap gap-x-3 px-3">
            {links.map((l) => <Ref key={l.kind} item={m} text={l.label ?? l.kind} url={l.url} actions={[]} />)}
          </div>
        )}
        <div className={cn('mx-3 flex items-center justify-between gap-2 border-t pt-2.5 text-xs', q ? 'text-warning' : answered ? 'text-success' : 'text-muted-foreground')}>
          {q && !isQueued(`q:${q.id}`) && loop?.open ? (
            // Answering happens in the inbox: close the loop view and put focus on that question.
            <button type="button" className="text-left font-medium underline underline-offset-3 hover:text-foreground" onClick={() => loop.hide(`[data-inbox-item="${q.id}"] :is(a[href], button, input):not([tabindex="-1"])`)}>
              {nextText}<span className="sr-only">, answer it in the inbox</span>
            </button>
          ) : <span>{nextText}</span>}
          <span className="flex flex-wrap justify-end gap-1"><Actions item={m} /></span>
        </div>
      </Card>
    </li>
  );
}

// A lane shows its first few cards; the rest stay one click away so a busy lane never takes the page.
const LANE_CAP = 5;
function Lane({ l }) {
  const [all, setAll] = useState(false);
  const shown = all ? l.items : l.items.slice(0, LANE_CAP);
  return (
    <div data-lane className="flex min-w-0 flex-col gap-2 bg-muted/60 p-2">
      <h3 className="flex items-center gap-2 px-1 pt-1 font-heading text-xs font-semibold" id={`lane-${l.key}`}>
        <span className={cn('size-2 rounded-full', toneDot[l.dot])} aria-hidden="true" />{l.title} <span className="font-sans font-normal text-muted-foreground tabular-nums">{l.items.length}</span>
      </h3>
      {l.items.length ? (
        <ul className="flex flex-col gap-2" aria-labelledby={`lane-${l.key}`}>
          {shown.map((m) => <MrCard key={m.id} m={m} />)}
        </ul>
      ) : (
        <div className="px-1 pb-1 text-xs text-muted-foreground">{l.none}</div>
      )}
      {l.items.length > LANE_CAP && (
        <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show ${plural(l.items.length - LANE_CAP, 'more merge request')}`}
        </Button>
      )}
    </div>
  );
}

export function MrBoard() {
  const { state: s } = useDashboard();
  const board = s ? mrLanes(s) : null;
  return (
    <section className="@container flex flex-col gap-3" id="mrs" aria-labelledby="h-mrs">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="h-mrs" className="font-heading text-sm font-semibold">My merge requests</h2>
        <span className="text-xs text-muted-foreground">{board ? `${board.total} open · grouped by what they wait for` : ''}</span>
      </div>
      <div className="grid grid-cols-1 items-start gap-3 @[460px]:grid-cols-2 @[1000px]:grid-cols-4">
        {board
          ? LANES.map(({ key }) => <Lane key={key} l={board.lanes[key]} />)
          : [0, 1].map((k) => <Skeleton key={k} className="h-40" />)}
      </div>
    </section>
  );
}
