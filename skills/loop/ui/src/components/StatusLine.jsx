import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useDashboard } from '../dashboard.jsx';
import { useLoopView } from '../loop.jsx';
import { hhmm, label, nextCheck, plural, waitingRuns } from '../format.js';
import { mrLanes } from './MrBoard.jsx';
import { LoopThreadLink, PauseButton } from './Header.jsx';

// The health strip above the inbox: live or not, merge requests, agents, any required source
// (MCP server / CLI) that is down, and worker threads waiting for an answer (also on phones: T3 Code
// runs there too). The loop counts open the loop view; on phones (no loop view) they
// are plain text.
export function StatusLine() {
  const { state: s, live, offline, updatedAt, act } = useDashboard();
  const loop = useLoopView();
  const nav = 'flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground';
  if (!s) return <nav className={nav} aria-label="Overview"><Skeleton className="h-4 w-48" /></nav>;
  const { lanes, total } = mrLanes(s);
  const running = s.items.filter((i) => i.agent_id).length;
  const maxAgents = s.loops.reduce((n, l) => n + (l.loop.maxAgents ?? 3), 0);
  const blocked = lanes.you.items.length;
  const mrs = <>{plural(total, 'merge request')}{blocked ? <>, <b className="font-semibold">{blocked} blocked on you</b></> : ''}</>;
  const agents = `${running} of ${maxAgents} agents busy`;
  // While the server is away the schedule is unknown: say how old the data is instead.
  const when = offline ? (updatedAt ? `data from ${hhmm(updatedAt)}` : '') : s.multi ? '' : nextCheck(s.loop);
  const open = (e) => { e.preventDefault(); loop.show(); };
  const link = 'underline-offset-4 hover:text-foreground hover:underline';
  const hot = blocked && 'font-medium text-warning';
  // Worker threads (runner: t3) that stopped to ask something: only the user can answer, in T3 Code.
  const asking = waitingRuns(s.runs).map((a) => ({ ...a, name: label(s.items.find((i) => i.id === a.item && i.loop === a.loop)) || a.item }));
  // A source the loop reported missing or failing: its work is skipped until it is back.
  const down = s.sources.filter((x) => x.status !== 'ok' && x.status !== 'unchecked');
  const sourceName = (x) => `${s.multi ? `${x.loopName}: ` : ''}${x.name.replace(/^(mcp|cli):/, '')}${x.message ? ` (${x.message})` : ` ${x.status}`}`;
  return (
    <div className="flex flex-col gap-2">
    <nav className={nav} aria-label="Overview">
      <span className={cn('inline-flex items-center gap-2', offline && 'font-semibold text-danger')}>
        <span className={cn('size-2 rounded-full bg-muted-foreground/40', offline ? 'bg-danger' : live && 'bg-success')} aria-hidden="true" />{offline ? 'Offline' : live ? 'Live' : 'Connecting'}{when ? ` · ${when}` : ''}
      </span>
      {loop.available ? (
        <>
          <a href="#loop" onClick={open} className={cn(link, hot)}>{mrs}</a>
          <a href="#loop" onClick={open} className={link}>{agents}</a>
        </>
      ) : (
        <>
          <span className={cn(hot)}>{mrs}</span>
          <span>{agents}</span>
        </>
      )}
      {down.length > 0 && (
        <span className="font-medium text-danger" data-sources-down>
          {down.length === 1 ? 'Source down' : 'Sources down'}: {down.map(sourceName).join(', ')}
        </span>
      )}
    </nav>
    {asking.length > 0 && (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-warning" data-workers-waiting>
        {asking.length === 1 ? '1 worker is waiting for your answer in T3 Code:' : `${asking.length} workers are waiting for your answer in T3 Code:`}
        {asking.filter((a) => a.link).map((a) => (
          <a key={`${a.loop}:${a.chain}:${a.repo}`} href={a.link} target="_blank" rel="noopener" className="underline underline-offset-4 hover:text-foreground max-sm:inline-flex max-sm:min-h-10 max-sm:items-center" aria-label={`Open the T3 Code thread of the ${a.repo} worker on ${a.name} (opens in a new tab)`}>{a.name} · {a.repo}</a>
        ))}
      </p>
    )}
    {s.multi && (
      <ul className="flex flex-col gap-1.5" aria-label="Loops shown">
        {s.loops.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" data-loop-row={l.id}>
            <span className="inline-flex min-w-32 items-center gap-2 font-medium text-foreground">
              <span className={cn('size-2 rounded-full bg-muted-foreground/40', l.running && (l.loop.paused ? 'bg-warning' : 'bg-success'))} aria-hidden="true" />{l.name}
            </span>
            <span>{!l.running ? 'Stopped' : l.loop.paused ? 'Paused' : nextCheck(l.loop) || 'Live'}</span>
            <span>{plural(s.items.filter((i) => i.loop === l.id && i.agent_id).length, 'agent')} busy</span>
            <LoopThreadLink loop={l} size="xs" />
            {l.running && <PauseButton loop={l} act={act} size="xs" />}
          </li>
        ))}
      </ul>
    )}
    </div>
  );
}
