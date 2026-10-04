import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useDashboard } from '../dashboard.jsx';
import { useLoopView } from '../loop.jsx';
import { hhmm, nextCheck, plural } from '../format.js';
import { mrLanes } from './MrBoard.jsx';
import { PauseButton } from './Header.jsx';

// The health strip above the inbox: live or not, merge requests, agents. The loop counts open the
// loop view; on phones (no loop view) they are plain text.
export function StatusLine() {
  const { state: s, live, offline, updatedAt, act } = useDashboard();
  const loop = useLoopView();
  const nav = 'flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground';
  if (!s) return <nav className={nav} aria-label="Overview"><Skeleton className="h-4 w-48" /></nav>;
  const { lanes, total } = mrLanes(s);
  const running = s.items.filter((i) => i.agent_id).length;
  const maxAgents = s.loops.reduce((n, l) => n + (l.loop.maxAgents || 3), 0);
  const blocked = lanes.you.items.length;
  const mrs = <>{plural(total, 'merge request')}{blocked ? <>, <b className="font-semibold">{blocked} blocked on you</b></> : ''}</>;
  const agents = `${running} of ${maxAgents} agents busy`;
  // While the server is away the schedule is unknown: say how old the data is instead.
  const when = offline ? (updatedAt ? `data from ${hhmm(updatedAt)}` : '') : s.multi ? '' : nextCheck(s.loop);
  const open = (e) => { e.preventDefault(); loop.show(); };
  const link = 'underline-offset-4 hover:text-foreground hover:underline';
  const hot = blocked && 'font-medium text-warning';
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
    </nav>
    {s.multi && (
      <ul className="flex flex-col gap-1.5" aria-label="Loops shown">
        {s.loops.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" data-loop-row={l.id}>
            <span className="inline-flex min-w-32 items-center gap-2 font-medium text-foreground">
              <span className={cn('size-2 rounded-full bg-muted-foreground/40', l.running && (l.loop.paused ? 'bg-warning' : 'bg-success'))} aria-hidden="true" />{l.name}
            </span>
            <span>{!l.running ? 'Stopped' : l.loop.paused ? 'Paused' : nextCheck(l.loop) || 'Live'}</span>
            <span>{plural(s.items.filter((i) => i.loop === l.id && i.agent_id).length, 'agent')} busy</span>
            {l.running && <PauseButton loop={l} act={act} size="xs" />}
          </li>
        ))}
      </ul>
    )}
    </div>
  );
}
