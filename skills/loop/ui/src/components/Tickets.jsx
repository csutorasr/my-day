import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { Badge } from '@/components/ui/badge';
import { useDashboard } from '../dashboard.jsx';
import { Icon } from './Icon.jsx';
import { Count, Panel } from './Panel.jsx';
import { Ref } from './Ref.jsx';

const detail = (i) => [i.branch, i.repos?.join(', '), i.attempts ? `attempts ${i.attempts}` : ''].filter(Boolean).join(' · ');
const row = 'flex items-start gap-4 border-b px-4 py-3 last:border-b-0';

function Row({ i, actions, more }) {
  return (
    <li className={row}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Ref item={i} actions={actions} />
        <span className="text-sm">{i.title}</span>
        {more && detail(i) && <span className="text-xs text-muted-foreground">{detail(i)}</span>}
      </div>
      <Badge variant="outline" className="font-mono text-muted-foreground">{i.status}</Badge>
    </li>
  );
}

export function Tickets() {
  const { state: s } = useDashboard();
  const closed = new Set(s?.closedStatuses ?? []);
  const tickets = (s?.items ?? []).filter((i) => !['mr', 'review'].includes(i.type));
  // Failed tickets are in Needs you with their Retry; listing them here again would duplicate it.
  const open = tickets.filter((i) => !closed.has(i.status) && !i.failed);
  const done = tickets.filter((i) => closed.has(i.status));
  return (
    <Panel titleId="h-tickets" title="Tickets" extra={<Count n={open.length} />}>
      <ul>
        {s && !open.length && <li className="px-4 py-3 text-sm text-muted-foreground">No open tickets in scope.</li>}
        {open.map((i) => <Row key={i.id} i={i} more />)}
      </ul>
      {done.length > 0 && (
        <details className="group border-t">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground max-sm:min-h-11 [&::-webkit-details-marker]:hidden">
            <Icon icon={ArrowRight01Icon} className="size-3.5 transition-transform group-open:rotate-90" />Closed ({done.length})
          </summary>
          <ul className="border-t">{done.map((i) => <Row key={i.id} i={i} actions={[]} />)}</ul>
        </details>
      )}
    </Panel>
  );
}
