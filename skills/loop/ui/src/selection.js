// Which loops the dashboard shows, and how their states combine. Pure; unit-tested by node --test.
// A loop entry comes from /api/loops: { id, name, running, stopped, paused, error? }.

export const apiFor = (loopId) => `/api/loops/${loopId}`;

const usable = (loops) => loops.filter((l) => !l.error);

// Running loops; with none running, every loop (the page should never be empty for no reason).
export function defaultSelection(loops) {
  const ok = usable(loops);
  const running = ok.filter((l) => l.running);
  return (running.length ? running : ok).map((l) => l.id);
}

// The loops the filter offers: running ones, plus the rest when "Show stopped" is on.
export function visibleLoops(loops, showStopped) {
  const ok = usable(loops);
  if (showStopped || !ok.some((l) => l.running)) return ok;
  return ok.filter((l) => l.running);
}

// A remembered selection, minus loops that are gone or hidden; nothing left → the default.
export function sanitizeSelection(saved, loops, showStopped) {
  const offered = new Set(visibleLoops(loops, showStopped).map((l) => l.id));
  const kept = Array.isArray(saved) ? saved.filter((id) => offered.has(id)) : [];
  return kept.length ? kept : defaultSelection(loops);
}

const LISTS = ['items', 'questions', 'failed', 'reviews', 'finishedToday', 'recent', 'runs', 'sources'];

// The inbox view over several loops: today's single-loop state shape, every row tagged with its
// loop (`loop` = id, `loopName`). `loop` / `dryRun` / … come from the first state, so a single
// selected loop looks exactly as before; `multi` says whether rows need a workspace badge.
export function mergeStates(states) {
  if (!states.length) return null;
  const [first] = states;
  const merged = { ...first, multi: states.length > 1, loops: states.map(({ id, name, running, stopped, paused, loop, host }) => ({ id, name, running, stopped, paused, loop, host })) };
  for (const key of LISTS) merged[key] = states.flatMap((s) => (s[key] ?? []).map((row) => ({ ...row, loop: s.id, loopName: s.name })));
  return merged;
}
