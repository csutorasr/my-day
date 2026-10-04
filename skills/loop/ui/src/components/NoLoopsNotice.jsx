import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useDashboard } from '../dashboard.jsx';

// The server answered, but no loop can be shown: none registered yet, or every store is gone.
export function NoLoopsNotice() {
  const { loops } = useDashboard();
  const broken = loops.filter((l) => l.error);
  return (
    <Alert variant="destructive" className="border-danger/40 bg-danger-soft">
      <AlertTitle>No loop can be shown.</AlertTitle>
      <AlertDescription>
        {broken.length ? (
          <ul className="flex flex-col gap-1">
            {broken.map((l) => <li key={l.id}>{l.name}: {l.error}</li>)}
          </ul>
        ) : 'No loop is registered on this machine yet.'}
        <p>Start one in a workspace folder with <code className="font-mono">/my-day:loop</code>.</p>
      </AlertDescription>
    </Alert>
  );
}
