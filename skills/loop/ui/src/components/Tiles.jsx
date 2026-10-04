import { useDashboard } from '../dashboard.jsx';
import { isApproval, plural, repoOf } from '../format.js';
import { mrLanes } from './MrBoard.jsx';

const Skel = ({ ch }) => <span className="skel" style={{ width: `${ch}ch`, height: 30 }} />;

function Tile({ href, k, value, tone, sub, skel = 2 }) {
  return (
    <a className="tile" href={href}>
      <span className="k">{k}</span>
      <span className={`v${tone ? ` ${tone}` : ''}`}>{value ?? <Skel ch={skel} />}</span>
      <span className="s">{sub}</span>
    </a>
  );
}

export function Tiles() {
  const { state: s } = useDashboard();
  if (!s) {
    return (
      <nav className="tiles" aria-label="Overview">
        <Tile href="#needs" k="Needs you" tone="t-warn" />
        <Tile href="#mrs" k="My merge requests" />
        <Tile href="#reviews" k="Reviews for you" tone="t-accent" />
        <Tile href="#agents" k="Agents" skel={3} />
      </nav>
    );
  }
  const approvals = s.questions.filter(isApproval).length;
  const questions = s.questions.length - approvals;
  const { lanes, total } = mrLanes(s);
  const repos = new Set(s.reviews.map(repoOf));
  const running = s.items.filter((i) => i.agent_id).length;
  return (
    <nav className="tiles" aria-label="Overview">
      <Tile href="#needs" k="Needs you" tone="t-warn" value={s.questions.length}
        sub={s.questions.length ? `${plural(approvals, 'approval')} · ${plural(questions, 'question')}` : 'nothing waiting'} />
      <Tile href="#mrs" k="My merge requests" value={total}
        sub={`${lanes.you.items.length} need you · ${lanes.wait.items.length} waiting`} />
      <Tile href="#reviews" k="Reviews for you" tone="t-accent" value={s.reviews.length}
        sub={s.reviews.length ? `across ${plural(repos.size, 'repo')}` : 'all caught up'} />
      <Tile href="#agents" k="Agents" value={`${running}/${s.loop.maxAgents || 3}`}
        sub={`${s.finishedToday.length} finished today`} />
    </nav>
  );
}
