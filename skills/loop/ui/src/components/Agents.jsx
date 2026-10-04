import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toneBadge } from '@/lib/tone';
import { useDashboard } from '../dashboard.jsx';
import { agentTask, hhmm, runStep } from '../format.js';
import { Panel } from './Panel.jsx';
import { Ref } from './Ref.jsx';

export function Agents() {
  const { state: s } = useDashboard();
  const max = s?.loop.maxAgents || 3;
  const running = (s?.items ?? []).filter((i) => i.agent_id);
  const finished = (s?.finishedToday ?? []).slice().reverse();
  const entry = 'flex items-start gap-3';
  return (
    <Panel id="agents" titleId="h-agents" title="Agents" extra={<span className="text-xs text-muted-foreground">{s ? `${running.length} of ${max} slots busy` : ''}</span>}>
      <div className="flex flex-col gap-3 p-4">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${max}, minmax(0, 1fr))` }}>
          {Array.from({ length: max }, (_, k) => <span key={k} className={cn('h-1.5', k < running.length ? 'bg-primary' : 'bg-muted')} />)}
        </div>
        <div className="flex flex-col gap-3">
          {running.map((i) => {
            // A claude -p chain shows which repo it is in; subagents show their agent id.
            const run = runStep(i, s.runs);
            return (
              <div className={entry} key={i.id} data-agent={i.id}>
                <Badge className={toneBadge.wait}>running</Badge>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm">{agentTask(i)}{run ? ` · ${run.label}` : ''}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Ref item={i} actions={run ? ['stop'] : []} />
                    <span className="font-mono text-xs text-muted-foreground">{run ? `claude -p since ${hhmm(run.since)}` : `agent ${i.agent_id}`}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="pt-1 text-xs font-semibold text-muted-foreground">Finished today</div>
        <div className="flex flex-col gap-3">
          {s && !finished.length && <div className="text-sm text-muted-foreground">Nothing yet.</div>}
          {finished.map((f) => (
            <div className={entry} key={f.id}>
              <Badge className={toneBadge[f.status === 'done' || !f.status ? 'ok' : 'bad']}>{f.status ?? 'done'}</Badge>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm break-words">{f.message.replace(/^\S+ \w+: /, '')}</span>
                {f.item && <Ref item={s.items.find((i) => i.id === f.item.id) ?? f.item} actions={[]} />}
                {f.commits?.length > 0 && <span className="font-mono text-xs text-muted-foreground">{f.commits.map((c) => String(c).slice(0, 8)).join(' · ')}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
