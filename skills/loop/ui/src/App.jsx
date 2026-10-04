import { useCallback, useEffect, useRef } from 'react';
import { DashboardProvider, useDashboard } from './dashboard.jsx';
import { LoopPanel, LoopViewProvider, useLoopView } from './loop.jsx';
import { Header } from './components/Header.jsx';
import { NeedsYou } from './components/NeedsYou.jsx';
import { OfflineNotice } from './components/OfflineNotice.jsx';
import { StatusLine } from './components/StatusLine.jsx';
import { Toasts } from './components/Toasts.jsx';
import { ShortcutsDialog, useShortcuts } from './components/Shortcuts.jsx';

// The tab title carries the inbox count, so a background tab still says when something needs you.
function useTitleCount() {
  const { state: s } = useDashboard();
  const count = s ? s.questions.length + s.failed.length + s.reviews.length : 0;
  useEffect(() => { document.title = count ? `(${count}) my-day` : 'my-day'; }, [count]);
}

function Dashboard() {
  const { open } = useLoopView();
  const help = useRef(null);
  const openHelp = useCallback(() => help.current?.showModal(), []);
  useShortcuts(openHelp);
  useTitleCount();

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <Header onShortcuts={openHelp} />
      <main id="main" className="inbox-page" inert={open}>
        <OfflineNotice />
        <StatusLine />
        <NeedsYou />
      </main>
      <LoopPanel />
      <Toasts />
      <ShortcutsDialog dialogRef={help} />
    </>
  );
}

export function App() {
  return (
    <DashboardProvider>
      <LoopViewProvider>
        <Dashboard />
      </LoopViewProvider>
    </DashboardProvider>
  );
}
