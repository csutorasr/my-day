// When should the loop wake up next, and may it dispatch now?
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_WAKEUP = 3600; // ScheduleWakeup clamps to [60, 3600]

function dayRange(spec) {
  const [a, b] = spec.split('-').map((d) => DAYS.indexOf(d.trim()));
  if (a < 0) return new Set([0, 1, 2, 3, 4, 5, 6]);
  const out = new Set();
  for (let d = a; ; d = (d + 1) % 7) { out.add(d); if (d === (b < 0 ? a : b)) break; }
  return out;
}

const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };

export function inWorkingHours(settings, now = new Date()) {
  const [from, to] = String(settings.workingHours).split('-');
  const t = now.getHours() * 60 + now.getMinutes();
  return dayRange(settings.workingDays).has(now.getDay()) && t >= minutes(from) && t < minutes(to);
}

// Seconds until the next working window opens (0 when inside one).
export function secondsToWindow(settings, now = new Date()) {
  if (inWorkingHours(settings, now)) return 0;
  const start = minutes(String(settings.workingHours).split('-')[0]);
  for (let add = 0; add <= 7; add++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, Math.floor(start / 60), start % 60);
    if (d > now && dayRange(settings.workingDays).has(d.getDay())) return Math.round((d - now) / 1000);
  }
  return MAX_WAKEUP;
}

export function schedule(settings, runningAgents, now = new Date()) {
  const inHours = inWorkingHours(settings, now);
  const freeSlots = inHours ? Math.max(0, settings.maxAgents - runningAgents) : 0;
  let delaySeconds;
  let reason;
  if (!inHours) {
    delaySeconds = Math.min(MAX_WAKEUP, Math.max(60, secondsToWindow(settings, now)));
    reason = 'outside working hours: read-only refresh, no dispatch';
  } else if (runningAgents > 0) {
    delaySeconds = Math.min(MAX_WAKEUP, settings.busyFallbackMinutes * 60);
    reason = `${runningAgents} agent(s) running; completion wakes the loop earlier`;
  } else {
    delaySeconds = Math.min(MAX_WAKEUP, settings.idleMinutes * 60);
    reason = 'idle cadence';
  }
  return { inHours, runningAgents, freeSlots, delaySeconds, reason, dryRun: settings.dryRun };
}
