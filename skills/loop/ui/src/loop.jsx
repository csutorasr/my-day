import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useDashboard, useIsPhone } from './dashboard.jsx';
import { Activity } from './components/Activity.jsx';
import { Agents } from './components/Agents.jsx';
import { MrBoard } from './components/MrBoard.jsx';
import { OfflineNotice } from './components/OfflineNotice.jsx';
import { Tickets } from './components/Tickets.jsx';
import { nextCheck } from './format.js';

// Two screens: the inbox is the page; the loop view (board, agents, tickets, activity) opens on
// demand as a full-width panel at #loop, so reload, back and shared links keep it. Phones get the
// inbox only.
const Ctx = createContext(null);
export const useLoopView = () => useContext(Ctx);

const HASH = '#loop';

export function LoopViewProvider({ children }) {
  const phone = useIsPhone();
  const [hash, setHash] = useState(() => window.location.hash);
  const pushed = useRef(false);
  const returnTo = useRef(null);

  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const open = hash === HASH && !phone;

  const show = useCallback(() => {
    if (window.location.hash === HASH) return;
    returnTo.current = document.activeElement;
    pushed.current = true;
    window.location.hash = 'loop';
  }, []);

  // Close, then put focus back where it was, or on `focusSelector` (e.g. a question in the inbox).
  // Focus moves once the panel is gone and the inbox is interactive again, also after Back.
  const focusAfter = useRef(null);
  const hide = useCallback((focusSelector) => {
    if (window.location.hash !== HASH) return;
    focusAfter.current = focusSelector ?? null;
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      setHash('');
    }
  }, []);

  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const target = focusAfter.current && document.querySelector(focusAfter.current);
      const back = returnTo.current?.isConnected ? returnTo.current : null;
      (target || back || document.getElementById('h-needs'))?.focus();
      focusAfter.current = null;
      returnTo.current = null;
    }
    wasOpen.current = open;
  }, [open]);

  const toggle = useCallback(() => (window.location.hash === HASH ? hide() : show()), [hide, show]);

  return <Ctx.Provider value={{ open, show, hide, toggle, available: !phone }}>{children}</Ctx.Provider>;
}

const FOCUSABLE = 'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input, select, textarea, summary, [tabindex="0"]';

export function LoopPanel() {
  const { open, hide } = useLoopView();
  const { state: s, offline } = useDashboard();
  const panel = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    document.getElementById('h-loop')?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  // Keep Tab inside the panel; Escape closes it.
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && !e.target.matches('input, textarea, select')) { e.stopPropagation(); hide(); return; }
    if (e.key !== 'Tab') return;
    const items = [...panel.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const [first, last] = [items[0], items.at(-1)];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current.querySelector('#h-loop'))) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  };

  return (
    <section ref={panel} className="loop-panel" role="dialog" aria-modal="true" aria-labelledby="h-loop" onKeyDown={onKeyDown}>
      <div className="loop-bar">
        <h2 id="h-loop" tabIndex={-1}>Loop</h2>
        <span className="muted small">What the loop is doing{s && !offline ? ` · ${nextCheck(s.loop) || 'no check scheduled'}` : ''}</span>
        <span className="grow" />
        <button type="button" className="btn" onClick={() => hide()} aria-keyshortcuts="Escape l">Back to inbox</button>
      </div>
      <div className="loop-body">
        <OfflineNotice />
        <MrBoard />
        <div className="loop-grid">
          <Tickets />
          <div className="stack">
            <Agents />
            <Activity />
          </div>
        </div>
      </div>
    </section>
  );
}
