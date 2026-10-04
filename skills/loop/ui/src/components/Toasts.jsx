import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDashboard } from '../dashboard.jsx';

// Bottom stack: one toast per queued action with a countdown and Undo, then the last confirmation.
// It sits above the loop view.
export function Toasts() {
  const { outbox, undo, toastText, toastError, dismissToast } = useDashboard();
  // Re-render four times a second while something is queued so the countdown moves.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!outbox.length) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [outbox.length]);
  const now = Date.now();

  if (!outbox.length && !toastText) return null;
  const toast = 'flex items-center gap-4 px-4 py-2.5 text-sm shadow-lg ring-1 ring-foreground/10 animate-[rise_.18s_ease-out]';
  return (
    <div data-toasts className="fixed bottom-5 left-1/2 z-30 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
      {outbox.map((e) => (
        <div className={cn(toast, 'bg-foreground text-background')} key={e.key}>
          <span>{e.label} in {Math.max(1, Math.ceil((e.until - now) / 1000))}s</span>
          <Button size="sm" variant="outline" className="border-background/40 bg-transparent text-background hover:bg-background/15 hover:text-background dark:bg-transparent" onClick={() => undo(e.key)}>Undo</Button>
        </div>
      ))}
      {toastText && (
        <div className={cn(toast, toastError ? 'bg-card text-danger ring-danger/40' : 'bg-foreground text-background')} role={toastError ? 'alert' : undefined}>
          <span>{toastText}</span>
          {toastError && <Button size="sm" variant="destructive" onClick={dismissToast}>Dismiss</Button>}
        </div>
      )}
    </div>
  );
}
