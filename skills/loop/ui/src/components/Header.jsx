import { useDashboard, useNotifications, useTheme } from '../dashboard.jsx';
import { nextCheck } from '../format.js';
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

export function Header() {
  const { state: s, live, act } = useDashboard();
  const notifications = useNotifications();
  const nxt = s ? nextCheck(s.loop) : '';
  return (
    <header>
      <div className="bar">
        <div className="brand">
          <span className={`live${live ? ' on' : ''}`} title="Live connection to the loop" />
          <b>my-day</b>
          <span className="mono muted small" id="dir">{s ? s.dir.split('/').slice(-2, -1)[0] ?? s.dir : ''}</span>
        </div>
        <div className="chips">
          <span className={`chip ${s?.dryRun ? 'warn' : 'accent'}`}>{s?.dryRun ? 'Dry run' : 'Live'}</span>
          {s?.loop.paused && <span className="chip warn">Paused</span>}
          {s && <span className="chip" id="hours">Working hours {s.loop.workingHours}</span>}
          {nxt && <span className="chip">{nxt}</span>}
        </div>
        <span className="grow" />
        <ThemeSwitch />
        <button className="btn" type="button" onClick={() => act(`/api/loop/${s?.loop.paused ? 'resume' : 'pause'}`)}>
          {s?.loop.paused ? 'Resume loop' : 'Pause loop'}
        </button>
        <button className="btn link" type="button" onClick={() => notifications.enable().catch(() => {})}>
          {notifications.on ? 'Notifications on' : 'Enable notifications'}
        </button>
      </div>
    </header>
  );
}
