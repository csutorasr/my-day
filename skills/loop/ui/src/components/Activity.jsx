import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { toneDot } from '@/lib/tone';
import { getJson } from '../api.js';
import { useDashboard } from '../dashboard.jsx';
import { dotFor, eventLabel, hhmm } from '../format.js';
import { Panel } from './Panel.jsx';
import { Ref } from './Ref.jsx';

const SHOWN = 30;

// Event log for a day range; reloads whenever the state changes (SSE) or the range does.
// Picking a date applies it at once; clearing both dates goes back to today.
export function Activity() {
  const { state: s } = useDashboard();
  const [preset, setPreset] = useState('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [all, setAll] = useState(false);
  const [events, setEvents] = useState(null);

  const range = from || to ? Object.fromEntries([['from', from], ['to', to]].filter(([, v]) => v)) : { [preset]: '1' };
  const key = JSON.stringify(range);

  useEffect(() => {
    if (!s) return undefined;
    let stale = false;
    getJson('/api/summary?' + new URLSearchParams(JSON.parse(key)))
      .then((sum) => { if (!stale) setEvents(sum.events.filter((e) => e.kind !== 'created').reverse()); })
      .catch(() => {});
    return () => { stale = true; };
  }, [s, key]);

  const pick = (p) => { setPreset(p); setFrom(''); setTo(''); setAll(false); };
  const byId = new Map((s?.items ?? []).map((i) => [i.id, i]));
  const custom = !!(from || to);
  const shown = all ? events : events?.slice(0, SHOWN);
  const date = cn('flex items-center gap-1.5 text-xs text-muted-foreground', custom && 'text-foreground');

  return (
    <Panel
      titleId="h-activity"
      title="Activity"
      extra={(
        <>
          <span className="grow" />
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup variant="outline" size="sm" spacing={0} aria-label="Day" value={custom ? [] : [preset]} onValueChange={(v) => v[0] && pick(v[0])}>
              <ToggleGroupItem value="today">Today</ToggleGroupItem>
              <ToggleGroupItem value="yesterday">Yesterday</ToggleGroupItem>
            </ToggleGroup>
            <label className={date}>From <Input type="date" className="h-7 w-auto" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setAll(false); }} /></label>
            <label className={date}>to <Input type="date" className="h-7 w-auto" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setAll(false); }} /></label>
          </div>
        </>
      )}
    >
      <div className="flex flex-col py-1">
        {events && !events.length && <div className="px-4 py-3 text-sm text-muted-foreground">No activity in this range.</div>}
        {shown?.map((e) => {
          const item = e.item_id ? byId.get(e.item_id) : null;
          return (
            <div className="grid grid-cols-[3rem_0.5rem_minmax(0,1fr)] items-start gap-3 px-4 py-2" key={e.id}>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{hhmm(e.ts)}</span>
              <span className={cn('mt-1.5 size-2 rounded-full', toneDot[dotFor(e.kind)])} aria-hidden="true" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm break-words">{e.message}</span>
                <span className="text-xs text-muted-foreground">
                  {eventLabel(e.kind)}{item || e.item_id ? ' · ' : ''}{item ? <Ref item={item} actions={[]} /> : e.item_id ?? ''}
                </span>
              </div>
            </div>
          );
        })}
        {events?.length > SHOWN && (
          <Button size="sm" variant="ghost" className="mx-4 my-2 self-start" onClick={() => setAll(!all)}>
            {all ? 'Show the latest only' : `Show all ${events.length} events`}
          </Button>
        )}
      </div>
    </Panel>
  );
}
