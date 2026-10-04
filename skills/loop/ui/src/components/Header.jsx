import { useEffect, useRef } from 'react';
import { useDashboard, useNotifications, useTheme } from '../dashboard.jsx';
import { useLoopView } from '../loop.jsx';
import { mrLanes } from './MrBoard.jsx';
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
  const { state: s, live, act, toast } = useDashboard();
  const notifications = useNotifications();
  const loop = useLoopView();
  // The loop view sits right below the header; the header wraps on narrow windows, so measure it.
  const bar = useRef(null);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => document.documentElement.style.setProperty('--header-h', `${Math.ceil(e.borderBoxSize?.[0]?.blockSize ?? e.target.offsetHeight)}px`));
    ro.observe(bar.current);
    return () => ro.disconnect();
  }, []);
  const blocked = s ? mrLanes(s).lanes.you.items.length : 0;

  const enable = async () => {
    if (notifications.permission === 'denied') {
      toast('Notifications are blocked for this page. Allow them in the browser’s site settings, then reload.', { error: true });
      return;
    }
    try { await notifications.enable(); } catch (err) { toast(`Could not turn on notifications: ${err.message}`, { error: true }); }
  };

  return (
    <header ref={bar}>
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
        </div>
        <span className="grow" />
        {loop.available && (
          <button className={`btn loop-btn${loop.open ? ' on' : ''}`} type="button" onClick={loop.toggle} aria-expanded={loop.open} aria-keyshortcuts="l">
            Loop{blocked ? <> · <b>{blocked} blocked on you</b></> : ''}
          </button>
        )}
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
