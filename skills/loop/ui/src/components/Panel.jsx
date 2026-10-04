import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

// A titled card that is also a landmark: `<h2 id={titleId}>` names the region.
export function Panel({ id, titleId, title, extra, children, className, headClassName }) {
  return (
    <Card id={id} role="region" aria-labelledby={titleId} className={cn('gap-0 py-0', className)}>
      <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3', headClassName)}>
        <h2 id={titleId} tabIndex={-1} className="font-heading text-sm font-semibold outline-none">{title}</h2>
        {extra}
      </div>
      {children}
    </Card>
  );
}

// The little count next to a panel title.
export function Count({ n, tone, label }) {
  if (!n) return null;
  return (
    <span aria-label={label} className={cn('px-1.5 py-px text-xs font-semibold tabular-nums', tone === 'warn' ? 'bg-warning-soft text-warning' : 'bg-muted text-muted-foreground')}>
      {n}
    </span>
  );
}
