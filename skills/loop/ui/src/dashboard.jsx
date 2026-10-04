import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getJson, post } from './api.js';
import { mergeStates, sanitizeSelection } from './selection.js';

const Ctx = createContext(null);
export const useDashboard = () => useContext(Ctx);

// How long a dashboard action waits before it is sent. The loop acts within seconds of receiving
// it (watch-dashboard), so this window is the only moment an action can still be taken back.
export const UNDO_MS = 8000;
const TOAST_MS = 4000;

// Loads /api/state, re-loads on every SSE `change`, retries every 5s while the server is away,
// and offers to every component:
// - `queue`: an outbox action (approve, decline, review, request) sent after UNDO_MS unless undone;
// - `act`: an immediate POST (pause / resume) with a toast and reload;
// - `toast`: a short confirmation.
// Which loops are shown, remembered per browser: { selected: [ids], showStopped }.
const PREFS = 'my-day-loops';
function readPrefs() {
  try { return { selected: null, showStopped: false, ...JSON.parse(localStorage.getItem(PREFS) ?? '{}') }; } catch { return { selected: null, showStopped: false }; }
}

export function DashboardProvider({ children }) {
  const [loops, setLoops] = useState([]);
  const [states, setStates] = useState(null);
  const [prefs, setPrefs] = useState(readPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [offline, setOffline] = useState(false);
  const [live, setLive] = useState(false);
  const [toastText, setToastText] = useState(null);
  const [toastError, setToastError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [outbox, setOutbox] = useState([]);
  const pending = useRef(new Map());
  const toastTimer = useRef();
  const retryTimer = useRef();

  // Confirmations fade after a few seconds; errors stay until dismissed so they can be read.
  const toast = useCallback((text, { error = false } = {}) => {
    setToastText(text);
    setToastError(error);
    clearTimeout(toastTimer.current);
    if (!error) toastTimer.current = setTimeout(() => setToastText(null), TOAST_MS);
  }, []);
  const dismissToast = useCallback(() => setToastText(null), []);

  const load = useCallback(async () => {
    clearTimeout(retryTimer.current);
    try {
      const list = await getJson('/api/loops');
      const { selected, showStopped } = prefsRef.current;
      const ids = sanitizeSelection(selected, list, showStopped);
      const { loops: got } = await getJson(`/api/state?loops=${ids.join(',')}`);
      setLoops(list);
      setStates(got);
      setUpdatedAt(Date.now());
      setOffline(false);
    } catch {
      setOffline(true);
      setLive(false);
      retryTimer.current = setTimeout(load, 5000);
    }
  }, []);

  // POST right away; on success show `ok` and reload, on failure show the server's error.
  const act = useCallback(
    async (path, payload, ok) => {
      try {
        await post(path, payload);
        if (ok) toast(ok);
        load();
      } catch (err) {
        toast(`That did not reach the loop: ${err.message}. Try again.`, { error: true });
      }
    },
    [load, toast],
  );

  const drop = useCallback((key) => {
    const entry = pending.current.get(key);
    if (!entry) return null;
    clearTimeout(entry.timer);
    pending.current.delete(key);
    setOutbox((o) => o.filter((x) => x.key !== key));
    return entry;
  }, []);

  // Outbox: `label` describes the queued action ("Approve q-3"), `ok` is shown once it is sent.
  const queue = useCallback(
    ({ key, label, path, payload, ok }) => {
      drop(key);
      const entry = { key, label, path, payload, ok, until: Date.now() + UNDO_MS };
      entry.timer = setTimeout(() => {
        if (drop(key)) act(path, payload, ok);
      }, UNDO_MS);
      pending.current.set(key, entry);
      setOutbox((o) => [...o, { key, label, until: entry.until }]);
    },
    [act, drop],
  );

  const undo = useCallback(
    (key) => {
      const entry = drop(key);
      if (entry) toast(`${entry.label}: undone, nothing was sent.`);
    },
    [drop, toast],
  );

  const isQueued = useCallback((key) => outbox.some((x) => x.key === key), [outbox]);

  // Closing the tab must not lose an action the user already chose: send what is still queued.
  useEffect(() => {
    const flush = () => {
      for (const e of pending.current.values()) {
        navigator.sendBeacon(e.path, new Blob([JSON.stringify(e.payload ?? {})], { type: 'application/json' }));
      }
      pending.current.clear();
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  useEffect(() => {
    load();
    const es = new EventSource('/api/stream');
    es.onopen = () => setLive(true);
    // A broken stream usually means the server went away: check, so the page can say its data is stale.
    es.onerror = () => { setLive(false); load(); };
    es.addEventListener('change', () => load());
    // Push delivers notifications when subscribed; otherwise fall back to page notifications.
    es.addEventListener('notify', async (m) => {
      const n = JSON.parse(m.data);
      if ('Notification' in window && Notification.permission === 'granted' && !(await hasPush())) new Notification(n.title, { body: n.body, tag: n.tag });
    });
    return () => { es.close(); clearTimeout(retryTimer.current); };
  }, [load]);

  const savePrefs = useCallback((next) => {
    const merged = { ...prefsRef.current, ...next };
    prefsRef.current = merged;
    setPrefs(merged);
    try { localStorage.setItem(PREFS, JSON.stringify(merged)); } catch {}
    load();
  }, [load]);
  const setSelected = useCallback((selected) => savePrefs({ selected }), [savePrefs]);
  const setShowStopped = useCallback((showStopped) => savePrefs({ showStopped }), [savePrefs]);

  // The inbox shows the selected loops merged; with one loop it is that loop's state, as before.
  const state = useMemo(() => (states ? mergeStates(states) : null), [states]);
  const selected = useMemo(() => (states ?? []).map((st) => st.id), [states]);

  return (
    <Ctx.Provider value={{ state, states, loops, selected, setSelected, showStopped: prefs.showStopped, setShowStopped, offline, live, updatedAt, load, act, queue, undo, isQueued, outbox, toast, toastText, toastError, dismissToast }}>
      {children}
    </Ctx.Provider>
  );
}

// The same dashboard, narrowed to one loop (the loop view): components keep reading `state`.
export function ScopedDashboard({ loop, children }) {
  const dash = useContext(Ctx);
  const one = dash.states?.find((st) => st.id === loop);
  const value = useMemo(() => ({ ...dash, state: one ? mergeStates([one]) : null }), [dash, one]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

async function hasPush() {
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(reg && (await reg.pushManager.getSubscription()));
}

// Browser notifications: page notifications always, web push when the server has a VAPID key.
// `permission` mirrors the browser: 'default' (not asked), 'granted' or 'denied'.
export function useNotifications() {
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));
  const enable = useCallback(async () => {
    const perm = await Notification.requestPermission();
    setPermission(perm);
    if (perm !== 'granted') return;
    const { enabled, publicKey } = await getJson('/api/push/key');
    if (!enabled || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (publicKey.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    await post('/api/push/subscribe', sub.toJSON());
  }, []);
  return { permission, enable };
}

// Phone-sized viewport: risky approvals and actions are not offered there.
const PHONE = '(max-width: 640px)';
export function useIsPhone() {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

// Theme: system (default) / light / dark, remembered per browser. index.html applies it before paint.
// Light / dark / system. The choice lives in data-theme and localStorage; the resolved theme is the
// .dark class shadcn's tokens key off, kept in step with the system setting while on "system".
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(choice) {
  document.documentElement.classList.toggle('dark', choice === 'dark' || (choice === 'system' && darkQuery.matches));
}

export function useTheme() {
  const [choice, setChoice] = useState(() => document.documentElement.dataset.theme ?? 'system');
  useEffect(() => {
    applyTheme(choice);
    if (choice !== 'system') return undefined;
    const on = () => applyTheme('system');
    darkQuery.addEventListener('change', on);
    return () => darkQuery.removeEventListener('change', on);
  }, [choice]);
  const set = useCallback((c) => {
    if (c === 'light' || c === 'dark') document.documentElement.dataset.theme = c;
    else delete document.documentElement.dataset.theme;
    try { c === 'system' ? localStorage.removeItem('my-day-theme') : localStorage.setItem('my-day-theme', c); } catch {}
    setChoice(c);
  }, []);
  return [choice, set];
}
