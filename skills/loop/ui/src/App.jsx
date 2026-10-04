import { useEffect, useRef } from 'react';
import { DashboardProvider, useDashboard } from './dashboard.jsx';
import { Activity } from './components/Activity.jsx';
import { Agents } from './components/Agents.jsx';
import { Header } from './components/Header.jsx';
import { MrBoard } from './components/MrBoard.jsx';
import { NeedsYou } from './components/NeedsYou.jsx';
import { Tickets } from './components/Tickets.jsx';
import { StatusLine } from './components/StatusLine.jsx';
import { Toasts } from './components/Toasts.jsx';

function Dashboard() {
  const { state, offline } = useDashboard();
  const entered = useRef(false);

  // Stagger the first paint; later updates (SSE) re-render in place without motion.
  useEffect(() => {
    if (!state || entered.current) return;
    entered.current = true;
    document.querySelectorAll('.panel, .lane').forEach((el, k) => {
      el.classList.add('enter');
      el.style.animationDelay = `${Math.min(k, 10) * 30}ms`;
    });
  }, [state]);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <Header />
      <main id="main">
        {offline && (
          <div className="offline" role="alert">
            Can’t reach the my-day server at this address. Retrying every few seconds. If it stopped, start it with <span className="mono">state.mjs bootstrap</span>.
          </div>
        )}
        <StatusLine />
        <div className="cols">
          <div className="stack">
            <NeedsYou />
            <MrBoard />
            <Tickets />
          </div>
          <aside className="stack" aria-label="Agents and activity">
            <Agents />
            <Activity />
          </aside>
        </div>
      </main>
      <Toasts />
    </>
  );
}

export function App() {
  return (
    <DashboardProvider>
      <Dashboard />
    </DashboardProvider>
  );
}
