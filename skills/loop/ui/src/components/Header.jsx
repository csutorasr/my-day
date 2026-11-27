import { useEffect, useRef } from 'react';
import { ComputerIcon, KeyboardIcon } from '@hugeicons/core-free-icons';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { useDashboard, useNotifications, useTheme } from '../dashboard.jsx';
import { useLoopView } from '../loop.jsx';
import { apiFor } from '../selection.js';
import { Icon } from './Icon.jsx';
import { mrLanes } from './MrBoard.jsx';

function ThemeSwitch() {
  const [choice, setChoice] = useTheme();
  return (
    <ToggleGroup variant="outline" size="sm" spacing={0} aria-label="Theme" value={[choice]} onValueChange={(v) => v[0] && setChoice(v[0])}>
      <ToggleGroupItem value="system" title="Follow the system setting"><Icon icon={ComputerIcon} />System</ToggleGroupItem>
      <ToggleGroupItem value="light">Light</ToggleGroupItem>
      <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
    </ToggleGroup>
  );
}

// Pause / resume one loop. With several loops shown, each row of the health strip has its own.
export function PauseButton({ loop, act, size }) {
  const paused = loop.loop?.paused ?? loop.paused;
  const name = loop.name;
  return (
    <Button variant="outline" size={size} onClick={() => act(`${apiFor(loop.id)}/${paused ? 'resume' : 'pause'}`, null, paused ? `${name}: loop resumed.` : `${name}: loop paused. Nothing new is started until you resume.`)} aria-label={`${paused ? 'Resume' : 'Pause'} loop ${name}`}>
      {paused ? 'Resume loop' : 'Pause loop'}
    </Button>
  );
}

// The loop's own session, when it runs as a T3 Code thread: where the user talks to it.
export function LoopThreadLink({ loop, size, className }) {
  const href = loop?.host?.threadLink;
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener" data-loop-thread={loop.id} className={cn(buttonVariants({ variant: 'outline', size }), className)} aria-label={`Open the T3 Code thread of loop ${loop.name} (opens in a new tab)`}>
      Loop thread
    </a>
  );
}

const NOTIFY_LABEL = { default: 'Enable notifications', granted: 'Notifications on', denied: 'Notifications blocked' };

export function Header({ onShortcuts }) {
  const { state: s, live, act, toast } = useDashboard();
  const notifications = useNotifications();
  const loop = useLoopView();
  const blocked = s ? mrLanes(s).lanes.you.items.length : 0;
  // The loop view sits right below the header; the header wraps on narrow windows, so measure it.
  const bar = useRef(null);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => document.documentElement.style.setProperty('--header-h', `${Math.ceil(e.borderBoxSize?.[0]?.blockSize ?? e.target.offsetHeight)}px`));
    ro.observe(bar.current);
    return () => ro.disconnect();
  }, []);

  const enable = async () => {
    if (notifications.permission === 'denied') {
      toast('Notifications are blocked for this page. Allow them in the browser’s site settings, then reload.', { error: true });
      return;
    }
    try { await notifications.enable(); } catch (err) { toast(`Could not turn on notifications: ${err.message}`, { error: true }); }
  };

  return (
    <header ref={bar} className="sticky top-0 z-10 border-b bg-card max-sm:static">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3 max-sm:px-4">
        <div className="flex items-center gap-2.5">
          <span className={cn('size-2.5 rounded-full bg-muted-foreground/40', live && 'bg-success shadow-[0_0_0_4px_var(--success-soft)] motion-safe:animate-[pulse-ring_2.4s_ease-in-out_infinite]')} aria-hidden="true" />
          <span className="sr-only" role="status">{live ? 'Connected to the loop' : 'Not connected to the loop'}</span>
          <h1 className="font-heading text-lg font-semibold tracking-tight">my-day</h1>
          <span className="font-mono text-xs text-muted-foreground max-sm:hidden">{s ? (s.multi ? `${s.loops.length} loops` : s.name) : ''}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className={s?.dryRun ? 'bg-warning-soft text-warning' : 'bg-primary/10 text-link'}>{s?.dryRun ? 'Dry run' : 'Live'}</Badge>
          {s && !s.multi && s.loop.paused && <Badge className="bg-warning-soft text-warning">Paused</Badge>}
          {s && !s.multi && <Badge variant="secondary" className="max-sm:hidden">Working hours {s.loop.workingHours}</Badge>}
        </div>
        <span className="grow" />
        {loop.available && (
          <Button variant="outline" className={cn(loop.open && 'border-primary bg-primary/10 text-link')} onClick={loop.toggle} aria-expanded={loop.open} aria-keyshortcuts="l">
            Loop{blocked ? <> · <b className="font-semibold text-warning">{blocked} blocked on you</b></> : ''}
          </Button>
        )}
        <ThemeSwitch />
        {s && !s.multi && <LoopThreadLink loop={s} />}
        {s && !s.multi && <PauseButton loop={s} act={act} />}
        <Button variant="ghost" className="text-muted-foreground" onClick={enable}>{NOTIFY_LABEL[notifications.permission]}</Button>
        <Button variant="ghost" className="text-muted-foreground max-sm:hidden" onClick={onShortcuts} aria-keyshortcuts="?"><Icon icon={KeyboardIcon} />Shortcuts</Button>
      </div>
    </header>
  );
}
