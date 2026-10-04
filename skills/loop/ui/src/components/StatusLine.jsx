import { useDashboard } from '../dashboard.jsx';
import { plural } from '../format.js';
import { mrLanes } from './MrBoard.jsx';

// One line of counts with jump links; the panels below carry the detail.
export function StatusLine() {
  const { state: s } = useDashboard();
  if (!s) return <nav className="status-line" aria-label="Overview"><span className="skel" style={{ width: '24ch' }} /></nav>;
  const waiting = s.questions.length + s.failed.length + s.reviews.length;
  const { lanes, total } = mrLanes(s);
  const running = s.items.filter((i) => i.agent_id).length;
  const blocked = lanes.you.items.length;
  return (
    <nav className="status-line" aria-label="Overview">
      <a href="#needs" className={waiting ? 'hot' : ''}>{waiting ? `${plural(waiting, 'thing')} need${waiting === 1 ? 's' : ''} you` : 'Nothing needs you'}</a>
      <a href="#mrs">{plural(total, 'merge request')}{blocked ? `, ${blocked} blocked on you` : ''}</a>
      <a href="#agents">{running} of {s.loop.maxAgents || 3} agents busy</a>
    </nav>
  );
}
