// GitLab provider (via `glab api`). Output shape shared with github.mjs.
import { execFileSync } from 'node:child_process';

const api = (endpoint) =>
  JSON.parse(execFileSync(process.env.GLAB_BIN ?? 'glab', ['api', endpoint], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const enc = encodeURIComponent;
let _me;
const me = () => (_me ??= api('user').username);
// Ticket references in a title/branch. Default matches KEY-123 (Jira, Linear, YouTrack …);
// override with --ticket-pattern, e.g. '#\\d+' for GitHub/GitLab issues.
export const DEFAULT_TICKET_PATTERN = '[A-Z][A-Z0-9]+-\\d+';
let ticketRe = new RegExp(DEFAULT_TICKET_PATTERN, 'g');
export const setTicketPattern = (p) => { if (p) ticketRe = new RegExp(p, 'g'); };
export const ticketKeys = (s) => [...new Set(s.match(ticketRe) ?? [])];

function summarize(m) {
  const full = m.references.full;
  const project = full.split('!')[0];
  return {
    ext: `gitlab:${full}`,
    project,
    repo: project.split('/').at(-1),
    iid: m.iid,
    title: m.title,
    url: m.web_url,
    draft: m.draft,
    target: m.target_branch,
    sourceBranch: m.source_branch,
    updatedAt: m.updated_at,
    ticketKeys: ticketKeys(`${m.title} ${m.source_branch}`),
  };
}

const inGroup = (group) => (m) => !group || m.references.full.startsWith(group);

export const mine = ({ group }) => api('merge_requests?state=opened&scope=assigned_to_me&per_page=100').filter(inGroup(group)).map(summarize);

export const reviews = ({ group }) =>
  api(`merge_requests?state=opened&scope=all&reviewer_username=${me()}&per_page=100`)
    .filter(inGroup(group))
    .filter((m) => !m.draft)
    .map(summarize);

export function mr(project, iid, { aiReviewer }) {
  const base = `projects/${enc(project)}/merge_requests/${iid}`;
  const m = api(base);
  const approvals = api(`${base}/approvals`);
  const unresolved = api(`${base}/discussions?per_page=100`)
    .filter((d) => d.notes.some((n) => n.resolvable && !n.resolved))
    .map((d) => {
      const n = d.notes[0];
      return {
        discussionId: d.id,
        noteId: n.id,
        author: n.author.username,
        fromAi: aiReviewer ? n.author.username === aiReviewer : /_bot_/.test(n.author.username),
        path: n.position?.new_path ?? null,
        line: n.position?.new_line ?? null,
        body: n.body,
        replies: d.notes.length - 1,
      };
    });
  const p = m.head_pipeline;
  return {
    ...summarize(m),
    mergeStatus: m.detailed_merge_status,
    blockingResolved: m.blocking_discussions_resolved,
    hasConflicts: m.has_conflicts,
    rebaseInProgress: m.rebase_in_progress ?? false,
    approved: approvals.approved ?? false,
    approvedBy: (approvals.approved_by ?? []).map((a) => a.user.username),
    pipeline: p ? { id: p.id, status: p.status, sha: p.sha, url: p.web_url } : null,
    headSha: m.sha,
    reviewers: (m.reviewers ?? []).map((r) => r.username),
    unresolved,
  };
}

export function reviewStatus(project, iid, { since }) {
  const base = `projects/${enc(project)}/merge_requests/${iid}`;
  const user = me();
  const approvedByMe = (api(`${base}/approvals`).approved_by ?? []).some((a) => a.user.username === user);
  const mine = api(`${base}/notes?sort=desc&per_page=100`).filter((n) => !n.system && n.author.username === user && (!since || n.created_at > since));
  return { approvedByMe, myNotesSince: mine.length, lastMyNoteAt: mine[0]?.created_at ?? null, done: approvedByMe || mine.length > 0 };
}

// opened | merged | closed
export const state = (project, iid) => api(`projects/${enc(project)}/merge_requests/${iid}`).state;
