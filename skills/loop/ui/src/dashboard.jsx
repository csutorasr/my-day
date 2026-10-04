import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getJson, post } from './api.js';

const Ctx = createContext(null);
export const useDashboard = () => useContext(Ctx);

// Loads /api/state, re-loads on every SSE `change`, retries every 5s while the server is away,
// and offers `act` (POST + toast + reload) and `toast` to every component.
export function DashboardProvider({ children }) {
  const [state, setState] = useState(null);
  const [offline, setOffline] = useState(false);
  const [live, setLive] = useState(false);
  const [toastText, setToastText] = useState(null);
  const toastTimer = useRef();
  const retryTimer = useRef();

  const toast = useCallback((text) => {
    setToastText(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(null), 1800);
  }, []);

  const load = useCallback(async () => {
    clearTimeout(retryTimer.current);
    try {
      setState(await getJson('/api/state'));
      setOffline(false);
    } catch {
      setOffline(true);
      setLive(false);
      retryTimer.current = setTimeout(load, 5000);
    }
  }, []);

  // POST an action; on success show `ok` and reload, on failure show the server's error.
  const act = useCallback(
    async (path, payload, ok) => {
      try {
        await post(path, payload);
        if (ok) toast(ok);
        load();
      } catch (err) {
        toast(err.message);
      }
    },
    [load, toast],
  );

  useEffect(() => {
    load();
    const es = new EventSource('/api/stream');
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.addEventListener('change', () => load());
    // Push delivers notifications when subscribed; otherwise fall back to page notifications.
    es.addEventListener('notify', async (m) => {
      const n = JSON.parse(m.data);
      if ('Notification' in window && Notification.permission === 'granted' && !(await hasPush())) new Notification(n.title, { body: n.body, tag: n.tag });
    });
    return () => { es.close(); clearTimeout(retryTimer.current); };
  }, [load]);

  return <Ctx.Provider value={{ state, offline, live, load, act, toast, toastText }}>{children}</Ctx.Provider>;
}

async function hasPush() {
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(reg && (await reg.pushManager.getSubscription()));
}

// Browser notifications: page notifications always, web push when the server has a VAPID key.
export function useNotifications() {
  const [on, setOn] = useState(() => 'Notification' in window && Notification.permission === 'granted');
  const enable = useCallback(async () => {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    setOn(true);
    const { enabled, publicKey } = await getJson('/api/push/key');
    if (!enabled || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (publicKey.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    await post('/api/push/subscribe', sub.toJSON());
  }, []);
  return { on, enable };
}

// Theme: system (default) / light / dark, remembered per browser. index.html applies it before paint.
export function useTheme() {
  const [choice, setChoice] = useState(() => document.documentElement.dataset.theme ?? 'system');
  const set = useCallback((c) => {
    if (c === 'light' || c === 'dark') document.documentElement.dataset.theme = c;
    else delete document.documentElement.dataset.theme;
    try { c === 'system' ? localStorage.removeItem('my-day-theme') : localStorage.setItem('my-day-theme', c); } catch {}
    setChoice(c);
  }, []);
  return [choice, set];
}
