import { WifiDisconnected01Icon } from '@hugeicons/core-free-icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useDashboard } from '../dashboard.jsx';
import { hhmm } from '../format.js';
import { Icon } from './Icon.jsx';

// Shown on both screens while the server is unreachable: how old the data is and how to recover.
export function OfflineNotice() {
  const { offline, updatedAt } = useDashboard();
  if (!offline) return null;
  return (
    <Alert variant="destructive" className="border-danger/40 bg-danger-soft">
      <Icon icon={WifiDisconnected01Icon} />
      <AlertTitle>The dashboard lost its connection to the loop.</AlertTitle>
      <AlertDescription>
        {updatedAt ? `What you see is from ${hhmm(updatedAt)} and may be out of date. ` : ''}
        It reconnects by itself; if the loop stopped, start it again in its session (Claude Code or a T3 Code thread) with <code className="font-mono">/my-day:loop</code>.
      </AlertDescription>
    </Alert>
  );
}
