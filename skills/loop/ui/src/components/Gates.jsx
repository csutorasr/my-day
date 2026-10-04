import { Badge } from '@/components/ui/badge';
import { gates } from '../format.js';
import { toneBadge } from '@/lib/tone';

// Merge-gate chips of an MR (pipeline, approvals, threads, conflicts, target).
export function Gates({ mr, target }) {
  return (
    <div className="flex flex-wrap gap-1">
      {gates(mr, target).map(([text, tone]) => <Badge key={text} className={toneBadge[tone]}>{text}</Badge>)}
    </div>
  );
}
