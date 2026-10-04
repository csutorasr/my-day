import { useDashboard } from '../dashboard.jsx';
import { useLoopView } from '../loop.jsx';
import { hhmm, nextCheck, plural } from '../format.js';
import { mrLanes } from './MrBoard.jsx';

// The health strip above the inbox: live or not, merge requests, agents. The loop counts open the
// loop view; on phones (no loop view) they are plain text.
export function StatusLine() {
  const { state: s, live, offline, updatedAt } = useDashboard();
  const loop = useLoopView();
  if (!s) return <nav className="status-line" aria-label="Overview"><span className="skel" style={{ width: '24ch' }} /></nav>;
  const { lanes, total } = mrLanes(s);
  const running = s.items.filter((i) => i.agent_id).length;
  const blocked = lanes.you.items.length;
  const mrs = <>{plural(total, 'merge request')}{blocked ? <>, <b>{blocked} blocked on you</b></> : ''}</>;
  const agents = `${running} of ${s.loop.maxAgents || 3} agents busy`;
  // While the server is away the schedule is unknown: say how old the data is instead.
  const when = offline ? (updatedAt ? `data from ${hhmm(updatedAt)}` : '') : nextCheck(s.loop);
  const open = (e) => { e.preventDefault(); loop.show(); };
  return (
    <nav className="status-line" aria-label="Overview">
      <span className={`health${offline ? ' bad' : live ? ' ok' : ''}`}>
        <span className="dot" aria-hidden="true" />{offline ? 'Offline' : live ? 'Live' : 'Connecting'}{when ? ` · ${when}` : ''}
      </span>
      {loop.available ? (
        <>
          <a href="#loop" onClick={open} className={blocked ? 'hot' : ''}>{mrs}</a>
          <a href="#loop" onClick={open}>{agents}</a>
        </>
      ) : (
        <>
          <span className={blocked ? 'hot' : ''}>{mrs}</span>
          <span>{agents}</span>
        </>
      )}
    </nav>
  );
}
