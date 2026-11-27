// Workspace config: .my-day/<NAME>.md, extended by .my-day/<NAME>.local.md.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The dev profile's files: required when LOOP.md has no `## Files` manifest (set up before profiles).
export const LEGACY_REQUIRED = [
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
export const REQUIRED = LEGACY_REQUIRED;

// Optional files: read when present; the skill that uses them falls back to its template.
// WRITES.md (approve-before-write policy): without it every outward action is `auto`, as before.
export const OPTIONAL = ['DREAM', 'WRITES'];

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
  mineBy: 'assignee', // which open MRs/PRs are mine, comma-separated: assignee | author | unassigned (needs group); both = author, assignee
  ticketPattern: '[A-Z][A-Z0-9]+-\\d+',
  aiReviewer: '', // bot account(s) whose review comments count as AI review (comma-separated)
  targetBranch: 'main',
  reviewBatchNotify: 3, // more new review requests than this → one summary notification
  hideCoveredReviews: false, // hide review requests others already approved / requested changes on
  dreamSchedule: '', // when my-day:dream is due, e.g. 'Fri 17:00'; empty = off
  runner: 'agent', // agent = Agent-tool subagents; claude-p = detached `claude -p` per repo (lib/runs.mjs)
  permissionMode: 'acceptEdits', // passed to claude -p --permission-mode
  runTimeoutMinutes: 90, // a claude -p run still alive after this is stopped and fails
  claudeBin: 'claude', // the CLI the runner starts ($CLAUDE_BIN overrides)
};

const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

// LOOP.md's `## Files` section names the files this workspace's loop needs, whatever the profile.
export function requiredFiles(dir) {
  const loop = read(join(dir, 'LOOP.md'));
  const section = loop && /^## Files[ \t]*\r?\n([\s\S]*?)(?=^#{1,2} |(?![\s\S]))/m.exec(loop);
  if (!section) return LEGACY_REQUIRED;
  const names = [...section[1].matchAll(/\b([A-Z][A-Z0-9-]*)\.md\b/g)].map((m) => m[1]);
  return ['LOOP', ...new Set(names.filter((n) => n !== 'LOOP'))];
}

export const findMissing = (dir) => requiredFiles(dir).filter((name) => !existsSync(join(dir, `${name}.md`)));

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
    // An empty value followed by a comment ("key:   # note") stays unset.
    if (kv && kv[2] !== '' && !kv[2].startsWith('#')) out[kv[1]] = coerce(kv[2]);
  }
  return out;
}

// LOOP.md `requires: mcp:atlassian, mcp:slack, cli:glab` (brackets optional): the sources the loop
// cannot work without. Unique, in order.
export function requiredSources(settings) {
  const raw = String(settings.requires ?? '').trim().replace(/^\[|\]$/g, '');
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
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
