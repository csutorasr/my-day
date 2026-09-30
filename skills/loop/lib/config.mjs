// Workspace config: .my-day/<NAME>.md, extended by .my-day/<NAME>.local.md.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REQUIRED = [
  'LOOP',
  'QUERY-MY-TASKS',
  'QUERY-MY-REVIEWS',
  'QUERY-INBOX',
  'TRIAGE',
  'WORKFLOW-STORY',
  'WORKFLOW-SUBTASK',
  'WORKFLOW-BUG',
  'DEVELOP',
  'FIX-REVIEW',
  'MERGE-GATES',
  'POST-MR',
];

export const DEFAULTS = {
  port: 4711,
  maxAgents: 3,
  retryLimit: 3,
  idleMinutes: 20,
  busyFallbackMinutes: 30,
  workingHours: '08:00-18:00',
  workingDays: 'Mon-Fri',
  retentionDays: 30,
  pipelineTimeoutMinutes: 60,
  dryRun: false,
  pushSubject: 'mailto:my-day@localhost.invalid',
  tracker: '', // jira | github | gitlab | linear | azure | other | none
  forge: 'gitlab', // gitlab | github
  group: '', // code-host group/org prefix whose MRs/PRs count
  ticketPattern: '[A-Z][A-Z0-9]+-\\d+',
  aiReviewer: '', // bot account whose review comments count as AI review
  targetBranch: 'main',
  reviewBatchNotify: 3, // more new review requests than this → one summary notification
  hideCoveredReviews: false, // hide review requests others already approved / requested changes on
};

const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

export const findMissing = (dir) => REQUIRED.filter((name) => !existsSync(join(dir, `${name}.md`)));

export function readConfig(dir, name) {
  const shared = read(join(dir, `${name}.md`));
  const local = read(join(dir, `${name}.local.md`));
  const parts = [];
  if (shared) parts.push(shared.trimEnd());
  if (local) parts.push(`<!-- ${name}.local.md — local overrides, wins on conflict -->\n${local.trimEnd()}`);
  return { name, shared, local, text: parts.join('\n\n') };
}

function coerce(v) {
  const q = /^(["'])(.*)\1$/.exec(v.trim());
  if (q) return q[2];
  const s = v.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

// Minimal "key: value" front matter; anything unparseable is ignored.
export function parseFrontmatter(text) {
  if (!text) return {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    // A comment needs whitespace before '#', so quoted values like '#\d+' survive.
    const kv = /^([A-Za-z][\w-]*)\s*:\s*("[^"]*"|'[^']*'|.*?)(\s+#.*)?$/.exec(line);
    if (kv && kv[2] !== '') out[kv[1]] = coerce(kv[2]);
  }
  return out;
}

export function loopSettings(dir) {
  const { shared, local } = readConfig(dir, 'LOOP');
  const merged = { ...DEFAULTS, ...parseFrontmatter(shared), ...parseFrontmatter(local) };
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (typeof def === 'number' && typeof merged[k] !== 'number') merged[k] = def;
    if (typeof def === 'boolean' && typeof merged[k] !== 'boolean') merged[k] = def;
  }
  return merged;
}
