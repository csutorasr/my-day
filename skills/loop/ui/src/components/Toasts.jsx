import { useEffect, useState } from 'react';
import { useDashboard } from '../dashboard.jsx';

// Bottom stack: one toast per queued action with a countdown and Undo, then the last confirmation.
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
  return (
    <div className="toasts" role="status" aria-live="polite">
      {outbox.map((e) => (
        <div className="toast" key={e.key}>
          <span>{e.label} in {Math.max(1, Math.ceil((e.until - now) / 1000))}s</span>
          <button type="button" onClick={() => undo(e.key)}>Undo</button>
        </div>
      ))}
      {toastText && (
        <div className={`toast${toastError ? ' error' : ''}`} role={toastError ? 'alert' : undefined}>
          <span>{toastText}</span>
          {toastError && <button type="button" onClick={dismissToast}>Dismiss</button>}
        </div>
      )}
    </div>
  );
}
