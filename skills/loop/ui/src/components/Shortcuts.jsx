import { useEffect, useRef } from 'react';
import { useDashboard } from '../dashboard.jsx';
import { useLoopView } from '../loop.jsx';

export const SHORTCUTS = [
  ['j / k', 'Next / previous item in Needs you (inbox only)'],
  ['a', 'Approve, send, mark reviewed or retry the focused item'],
  ['d', 'Decline or skip the focused item'],
  ['u', 'Undo the last action that is still waiting to be sent'],
  ['c', 'Copy the focused link'],
  ['l', 'Open or close the loop view (merge requests, agents, activity)'],
  ['Esc', 'Close the loop view'],
  ['?', 'Show these shortcuts'],
];

const inboxItems = () => [...document.querySelectorAll('#needs [data-inbox-item]:not([data-queued])')];
// The item's link, so a / d act on it right away (in an answer field they would type instead).
const firstControl = (item) => item.querySelector(':is(a[href], button, input):not([tabindex="-1"])');

// Global keyboard shortcuts. Ignored while typing in a field (Escape leaves the field).
// The inbox keys (j, k, a, d) pause while the loop view covers the inbox.
export function useShortcuts(openHelp) {
  const { outbox, undo, toast } = useDashboard();
  const loop = useLoopView();
  const last = useRef(outbox);
  last.current = outbox;
  const view = useRef(loop);
  view.current = loop;

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el?.matches('input, textarea, select')) {
        if (e.key === 'Escape') el.blur();
        return;
      }
      if (document.querySelector('dialog[open]')) return;
      const { open, available, toggle, hide } = view.current;
      if (e.key === 'Escape' && open) { hide(); e.preventDefault(); return; }
      if (e.key === 'l' && available) { toggle(); e.preventDefault(); return; }
      const item = open ? null : el?.closest('[data-inbox-item]');
      if ((e.key === 'j' || e.key === 'k') && !open) {
        const items = inboxItems();
        if (!items.length) return;
        const at = items.indexOf(item);
        const next = at < 0 ? items[0] : items[(at + (e.key === 'j' ? 1 : items.length - 1)) % items.length];
        firstControl(next)?.focus();
        e.preventDefault();
      } else if (e.key === 'a' && item) {
        (item.querySelector('[data-primary]') ?? item.querySelector('.act'))?.click();
        e.preventDefault();
      } else if (e.key === 'd' && item) {
        item.querySelector('[data-decline]')?.click();
        e.preventDefault();
      } else if (e.key === 'u') {
        const latest = last.current.at(-1);
        if (latest) undo(latest.key);
      } else if (e.key === 'c' && el?.dataset.copy) {
        navigator.clipboard.writeText(el.dataset.copy).then(() => toast('Link copied'), (err) => toast(`Could not copy the link: ${err.message}`, { error: true }));
      } else if (e.key === '?') {
        openHelp();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openHelp, undo, toast]);
}

export function ShortcutsDialog({ dialogRef }) {
  return (
    <dialog ref={dialogRef} className="shortcuts" aria-labelledby="h-shortcuts">
      <h2 id="h-shortcuts">Keyboard shortcuts</h2>
      <dl>
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{what}</dd></div>
        ))}
      </dl>
      <form method="dialog"><button className="btn" type="submit">Close</button></form>
    </dialog>
  );
}
