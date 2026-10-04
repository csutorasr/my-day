import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useDashboard } from '../dashboard.jsx';
import { useLoopView } from '../loop.jsx';
import { hhmm, nextCheck, plural } from '../format.js';
import { mrLanes } from './MrBoard.jsx';

// The health strip above the inbox: live or not, merge requests, agents. The loop counts open the
// loop view; on phones (no loop view) they are plain text.
export function StatusLine() {
  const { state: s, live, offline, updatedAt } = useDashboard();
  const loop = useLoopView();
  const nav = 'flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground';
  if (!s) return <nav className={nav} aria-label="Overview"><Skeleton className="h-4 w-48" /></nav>;
  const { lanes, total } = mrLanes(s);
  const running = s.items.filter((i) => i.agent_id).length;
  const blocked = lanes.you.items.length;
  const mrs = <>{plural(total, 'merge request')}{blocked ? <>, <b className="font-semibold">{blocked} blocked on you</b></> : ''}</>;
  const agents = `${running} of ${s.loop.maxAgents || 3} agents busy`;
  // While the server is away the schedule is unknown: say how old the data is instead.
  const when = offline ? (updatedAt ? `data from ${hhmm(updatedAt)}` : '') : nextCheck(s.loop);
  const open = (e) => { e.preventDefault(); loop.show(); };
  const link = 'underline-offset-4 hover:text-foreground hover:underline';
  const hot = blocked && 'font-medium text-warning';
  return (
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
  );
}
