import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { useDashboard } from '../dashboard.jsx';
import { visibleLoops } from '../selection.js';

// Which workspaces' loops the page shows. Only there when the machine runs more than one loop;
// running loops by default, stopped ones on request.
export function LoopFilter() {
  const { loops, selected, setSelected, showStopped, setShowStopped } = useDashboard();
  const usable = loops.filter((l) => !l.error);
  const broken = loops.filter((l) => l.error);
  if (usable.length < 2 && !broken.length) return null;
  const offered = visibleLoops(loops, showStopped);
  const anyStopped = usable.some((l) => !l.running);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-loop-filter>
      {usable.length > 1 && <ToggleGroup multiple variant="outline" size="sm" spacing={0} aria-label="Loops" value={selected} onValueChange={(v) => v.length && setSelected(v)}>
        {offered.map((l) => {
          const open = l.counts.questions + l.counts.failed + l.counts.reviews;
          return (
            <ToggleGroupItem key={l.id} value={l.id} aria-label={`${l.name}${l.running ? '' : ' (stopped)'}${open ? `, ${open} waiting` : ''}`}>
              <span className={cn('size-2 rounded-full bg-muted-foreground/40', l.running && (l.paused ? 'bg-warning' : 'bg-success'))} aria-hidden="true" />
              {l.name}
              {open > 0 && <span className="font-mono text-xs text-warning">{open}</span>}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>}
      {usable.length > 1 && anyStopped && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={showStopped} onCheckedChange={setShowStopped} aria-label="Show stopped" />
          Show stopped
        </label>
      )}
      {broken.length > 0 && (
        <ul className="flex w-full flex-col gap-1 text-xs text-danger" aria-label="Loops that cannot be shown" data-loop-broken>
          {broken.map((l) => <li key={l.id}><b className="font-semibold">{l.name}</b>: {l.error}. Restart its loop or run <code>state.mjs loops forget {l.id}</code>.</li>)}
        </ul>
      )}
    </div>
  );
}
