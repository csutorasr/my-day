import { useDashboard, useNotifications, useTheme } from '../dashboard.jsx';
import { hhmm, nextCheck } from '../format.js';
import { ScreenIcon } from './Icons.jsx';

function ThemeSwitch() {
  const [choice, setChoice] = useTheme();
  const option = (value, text, extra) => (
    <button type="button" role="radio" aria-checked={choice === value} onClick={() => setChoice(value)} {...extra}>
      {text}
    </button>
  );
  return (
    <div className="theme" role="radiogroup" aria-label="Theme">
      {option('system', <><ScreenIcon />System</>, { title: 'Follow the system setting' })}
      {option('light', 'Light')}
      {option('dark', 'Dark')}
    </div>
  );
}

const NOTIFY_LABEL = { default: 'Enable notifications', granted: 'Notifications on', denied: 'Notifications blocked' };

export function Header({ onShortcuts }) {
  const { state: s, live, offline, updatedAt, act, toast } = useDashboard();
  const notifications = useNotifications();
  // While the server is away, the schedule is unknown: show when the data was last fresh instead.
  const when = offline ? (updatedAt ? `Data from ${hhmm(updatedAt)}` : '') : s ? nextCheck(s.loop) : '';

  const enable = async () => {
    if (notifications.permission === 'denied') {
      toast('Notifications are blocked for this page. Allow them in the browser’s site settings, then reload.', { error: true });
      return;
    }
    try { await notifications.enable(); } catch (err) { toast(`Could not turn on notifications: ${err.message}`, { error: true }); }
  };

  return (
    <header>
      <div className="bar">
        <div className="brand">
          <span className={`live${live ? ' on' : ''}`} aria-hidden="true" />
          <span className="sr-only" role="status">{live ? 'Connected to the loop' : 'Not connected to the loop'}</span>
          <h1>my-day</h1>
          <span className="mono muted small" id="dir">{s ? s.dir.split('/').slice(-2, -1)[0] ?? s.dir : ''}</span>
        </div>
        <div className="chips">
          <span className={`chip ${s?.dryRun ? 'warn' : 'accent'}`}>{s?.dryRun ? 'Dry run' : 'Live'}</span>
          {s?.loop.paused && <span className="chip warn">Paused</span>}
          {s && <span className="chip" id="hours">Working hours {s.loop.workingHours}</span>}
          {when && <span className={`chip${offline ? ' warn' : ''}`}>{when}</span>}
        </div>
        <span className="grow" />
        <ThemeSwitch />
        <button className="btn" type="button" onClick={() => act(`/api/loop/${s?.loop.paused ? 'resume' : 'pause'}`, null, s?.loop.paused ? 'Loop resumed.' : 'Loop paused. Nothing new is started until you resume.')}>
          {s?.loop.paused ? 'Resume loop' : 'Pause loop'}
        </button>
        <button className="btn link" type="button" onClick={enable}>{NOTIFY_LABEL[notifications.permission]}</button>
        <button className="btn link kbd-only" type="button" onClick={onShortcuts} aria-keyshortcuts="?">Shortcuts</button>
      </div>
    </header>
  );
}
