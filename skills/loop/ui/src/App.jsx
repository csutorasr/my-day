import { useCallback, useRef } from 'react';
import { DashboardProvider, useDashboard } from './dashboard.jsx';
import { Activity } from './components/Activity.jsx';
import { Agents } from './components/Agents.jsx';
import { Header } from './components/Header.jsx';
import { MrBoard } from './components/MrBoard.jsx';
import { NeedsYou } from './components/NeedsYou.jsx';
import { Tickets } from './components/Tickets.jsx';
import { StatusLine } from './components/StatusLine.jsx';
import { Toasts } from './components/Toasts.jsx';
import { ShortcutsDialog, useShortcuts } from './components/Shortcuts.jsx';

function Dashboard() {
  const { offline, updatedAt } = useDashboard();
  const help = useRef(null);
  const openHelp = useCallback(() => help.current?.showModal(), []);
  useShortcuts(openHelp);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <Header onShortcuts={openHelp} />
      <main id="main">
        {offline && (
          <div className="offline" role="alert">
            <b>The dashboard lost its connection to the loop.</b>{' '}
            {updatedAt ? `What you see is from ${new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} and may be out of date. ` : ''}
            It reconnects by itself; if the loop stopped, start it again in Claude Code with <span className="mono">/my-day:loop</span>.
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
      <ShortcutsDialog dialogRef={help} />
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
