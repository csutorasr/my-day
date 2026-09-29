// Resolve summary date filters to ISO bounds [from, to) using local days.
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function parseDay(s) {
  if (s === 'today') return startOfDay(new Date());
  if (s === 'yesterday') return addDays(startOfDay(new Date()), -1);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`bad date ${s} (use YYYY-MM-DD, today, yesterday or ISO)`);
  return d;
}

const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) || s === 'today' || s === 'yesterday';

export function resolveRange({ today, yesterday, since, from, to } = {}, now = new Date()) {
  if (today) return { from: startOfDay(now).toISOString(), to: addDays(startOfDay(now), 1).toISOString() };
  if (yesterday) return { from: addDays(startOfDay(now), -1).toISOString(), to: startOfDay(now).toISOString() };
  const start = since ?? from;
  const range = {};
  if (start) range.from = parseDay(start).toISOString();
  if (to) {
    const end = parseDay(to);
    // A bare date as the upper bound means "through the end of that day".
    range.to = (isDateOnly(to) ? addDays(end, 1) : end).toISOString();
  }
  return range;
}
