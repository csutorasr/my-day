// When should the loop wake up next, and may it dispatch now?
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_WAKEUP = 3600; // ScheduleWakeup clamps to [60, 3600]

function dayRange(spec) {
  const [a, b = -1] = spec.split('-').map((d) => DAYS.indexOf(d.trim()));
  if (a < 0) return new Set([0, 1, 2, 3, 4, 5, 6]);
  const out = new Set();
  // A single day ("Fri") has no end: stop at the start day.
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

// Most recent occurrence of a dreamSchedule ("Fri 17:00", "Mon,Thu 09:30", "Mon-Fri 17:00") at or before now.
// Empty → off (null); unparseable → null.
export function lastDreamSlot(spec, now = new Date()) {
  const m = /^\s*([A-Za-z,\-\s]+?)\s+(\d{1,2}:\d{2})\s*$/.exec(String(spec ?? ''));
  if (!m) return null;
  const days = new Set();
  for (const part of m[1].split(',')) {
    if (!DAYS.includes(part.split('-')[0].trim())) return null;
    for (const d of dayRange(part)) days.add(d);
  }
  const t = minutes(m[2]);
  for (let back = 0; back <= 7; back++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, Math.floor(t / 60), t % 60);
    if (d <= now && days.has(d.getDay())) return d;
  }
  return null;
}

// Due when a scheduled slot passed since the last dream, and only inside working hours.
export function dreamDue(settings, lastDreamAt, now = new Date()) {
  if (!inWorkingHours(settings, now)) return false;
  const slot = lastDreamSlot(settings.dreamSchedule, now);
  if (!slot) return false;
  return !lastDreamAt || new Date(lastDreamAt) < slot;
}

// Every other `<name>Schedule` setting (e.g. statusSchedule: Fri 14:00) is a weekly slot like the
// dream's: due once it passed since `lastAt(name)` (meta last<Name>At), inside working hours.
export function dueSchedules(settings, lastAt, now = new Date()) {
  if (!inWorkingHours(settings, now)) return [];
  const due = [];
  for (const [key, spec] of Object.entries(settings)) {
    const m = /^([a-z][A-Za-z0-9]*)Schedule$/.exec(key);
    if (!m || m[1] === 'dream') continue;
    const slot = lastDreamSlot(spec, now);
    const last = slot && lastAt(m[1]);
    if (slot && (!last || new Date(last) < slot)) due.push(m[1]);
  }
  return due;
}

export function schedule(settings, runningAgents, now = new Date(), { lastDreamAt = null, lastAt = () => null } = {}) {
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
  return { inHours, runningAgents, freeSlots, delaySeconds, reason, dryRun: settings.dryRun, dreamDue: dreamDue(settings, lastDreamAt, now), due: dueSchedules(settings, lastAt, now) };
}
