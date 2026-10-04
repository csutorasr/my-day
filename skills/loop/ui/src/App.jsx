import { useCallback, useEffect, useState } from 'react';
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
  const [help, setHelp] = useState(false);
  const openHelp = useCallback(() => setHelp(true), []);
  useShortcuts(openHelp);
  useTitleCount();

  return (
    <>
      <a className="fixed -top-12 left-4 z-40 bg-primary px-3 py-2 text-sm text-primary-foreground focus:top-3" href="#main">Skip to content</a>
      <Header onShortcuts={openHelp} />
      <main id="main" className="mx-auto flex max-w-[880px] flex-col gap-6 p-6 max-sm:px-4" inert={open}>
        <OfflineNotice />
        <StatusLine />
        <NeedsYou />
      </main>
      <LoopPanel />
      <Toasts />
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
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
