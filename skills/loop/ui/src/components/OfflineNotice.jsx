import { useDashboard } from '../dashboard.jsx';
import { hhmm } from '../format.js';

// Shown on both screens while the server is unreachable: how old the data is and how to recover.
export function OfflineNotice() {
  const { offline, updatedAt } = useDashboard();
  if (!offline) return null;
  return (
    <div className="offline" role="alert">
      <b>The dashboard lost its connection to the loop.</b>{' '}
      {updatedAt ? `What you see is from ${hhmm(updatedAt)} and may be out of date. ` : ''}
      It reconnects by itself; if the loop stopped, start it again in Claude Code with <span className="mono">/my-day:loop</span>.
    </div>
  );
}
