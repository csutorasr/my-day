// GitHub provider (via `gh api`). Normalizes to the GitLab-shaped output of gitlab.mjs:
// mergeStatus uses GitLab's detailed_merge_status vocabulary, pipeline.status is
// success | failed | running | pending | null, derived from check runs.
import { execFileSync } from 'node:child_process';
import { ticketKeys } from './gitlab.mjs';

const gh = (args) =>
  JSON.parse(execFileSync(process.env.GH_BIN ?? 'gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const api = (endpoint) => gh([endpoint]);
let _me;
const me = () => (_me ??= api('user').login);

// "owner/repo" from an API repository URL.
const repoOf = (url) => url.replace(/^https:\/\/api\.github\.com\/repos\//, '');

// group = "owner/" (org or user) or "owner/repo"; becomes a search qualifier.
function scopeQualifier(group) {
  if (!group) return '';
  const g = group.replace(/\/$/, '');
  return g.includes('/') ? `+repo:${g}` : `+org:${g}`;
}

function summarize(pr, project) {
  return {
    ext: `github:${project}#${pr.number}`,
    project,
    repo: project.split('/').at(-1),
    iid: pr.number,
    title: pr.title,
    url: pr.html_url,
    draft: !!pr.draft,
    target: pr.base?.ref ?? null,
    sourceBranch: pr.head?.ref ?? null,
    updatedAt: pr.updated_at,
    ticketKeys: ticketKeys(`${pr.title} ${pr.head?.ref ?? ''}`),
  };
}

function search(q, group) {
  const items = api(`search/issues?q=${q}${scopeQualifier(group)}&per_page=100`).items ?? [];
  return items
    .filter((i) => !group || `${repoOf(i.repository_url)}/`.startsWith(`${group.replace(/\/$/, '')}/`))
    .map((i) => {
      const project = repoOf(i.repository_url);
      return summarize(api(`repos/${project}/pulls/${i.number}`), project);
    });
}

export const mine = ({ group }) => search('is:pr+is:open+assignee:@me', group);
export const reviews = ({ group }) => search('is:pr+is:open+draft:false+review-requested:@me', group);

const MERGE_STATE = {
  clean: 'mergeable',
  has_hooks: 'mergeable',
  behind: 'need_rebase',
  dirty: 'conflict',
  blocked: 'not_approved',
  unstable: 'ci_still_running',
  draft: 'draft_status',
  unknown: 'checking',
};

function checksStatus(project, sha) {
  const runs = api(`repos/${project}/commits/${sha}/check-runs?per_page=100`).check_runs ?? [];
  if (!runs.length) return null;
  if (runs.some((r) => ['failure', 'timed_out', 'cancelled', 'action_required'].includes(r.conclusion))) return 'failed';
  if (runs.some((r) => r.status !== 'completed')) return 'running';
  return 'success';
}

// Latest review per user decides; any outstanding CHANGES_REQUESTED blocks approval.
function approvalState(reviewList) {
  const latest = new Map();
  for (const r of reviewList) if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) latest.set(r.user.login, r.state);
  const approvedBy = [...latest].filter(([, s]) => s === 'APPROVED').map(([u]) => u);
  const changesRequested = [...latest].some(([, s]) => s === 'CHANGES_REQUESTED');
  return { approved: approvedBy.length > 0 && !changesRequested, approvedBy };
}

const THREADS = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved path line comments(first:100){totalCount nodes{databaseId body author{login}}}}}}}}`;

export function mr(project, number, { aiReviewer }) {
  const [owner, name] = project.split('/');
  const pr = api(`repos/${project}/pulls/${number}`);
  const { approved, approvedBy } = approvalState(api(`repos/${project}/pulls/${number}/reviews?per_page=100`));
  const threads = gh(['graphql', '-f', `query=${THREADS}`, '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`])
    .data.repository.pullRequest.reviewThreads.nodes;
  const unresolved = threads
    .filter((t) => !t.isResolved)
    .map((t) => {
      const c = t.comments.nodes[0];
      const author = c?.author?.login ?? 'ghost';
      return {
        discussionId: t.id,
        noteId: c?.databaseId ?? null,
        author,
        fromAi: aiReviewer ? author === aiReviewer : /\[bot\]$/.test(author),
        path: t.path,
        line: t.line,
        body: c?.body ?? '',
        replies: t.comments.totalCount - 1,
      };
    });
  const status = checksStatus(project, pr.head.sha);
  return {
    ...summarize(pr, project),
    mergeStatus: pr.draft ? 'draft_status' : MERGE_STATE[pr.mergeable_state] ?? 'checking',
    blockingResolved: unresolved.length === 0,
    hasConflicts: pr.mergeable_state === 'dirty',
    rebaseInProgress: false,
    approved,
    approvedBy,
    pipeline: status && { id: null, status, sha: pr.head.sha, url: `${pr.html_url}/checks` },
    headSha: pr.head.sha,
    reviewers: (pr.requested_reviewers ?? []).map((r) => r.login),
    unresolved,
  };
}

// My approval/comments since the request, plus the latest verdict of other reviewers and when
// my review was last (re)requested. GitHub has no "approvals left" count.
export function reviewStatus(project, number, { since }) {
  const user = me();
  const after = (ts) => !since || ts > since;
  const allReviews = api(`repos/${project}/pulls/${number}/reviews?per_page=100`);
  const myReviews = allReviews.filter((r) => r.user.login === user && after(r.submitted_at));
  const myComments = api(`repos/${project}/issues/${number}/comments?per_page=100`).filter((c) => c.user.login === user && after(c.created_at));
  const approvedByMe = myReviews.some((r) => r.state === 'APPROVED');
  const stamps = [...myReviews.map((r) => r.submitted_at), ...myComments.map((c) => c.created_at)].sort().reverse();
  const latest = new Map();
  for (const r of allReviews) if (r.user.login !== user && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) latest.set(r.user.login, r.state);
  const verdicts = [...latest.values()];
  const othersVerdict = verdicts.includes('CHANGES_REQUESTED') ? 'changes' : verdicts.includes('APPROVED') ? 'approved' : null;
  // First page only (oldest first); a PR with more than 100 timeline events may report an older request.
  const lastRequestedAt =
    api(`repos/${project}/issues/${number}/timeline?per_page=100`)
      .filter((e) => e.event === 'review_requested' && e.requested_reviewer?.login === user)
      .map((e) => e.created_at)
      .sort()
      .at(-1) ?? null;
  return {
    approvedByMe,
    myNotesSince: stamps.length,
    lastMyNoteAt: stamps[0] ?? null,
    done: approvedByMe || stamps.length > 0,
    othersVerdict,
    approvalsLeft: null,
    lastRequestedAt,
  };
}

// opened | merged | closed
export function state(project, number) {
  const pr = api(`repos/${project}/pulls/${number}`);
  return pr.merged ? 'merged' : pr.state === 'open' ? 'opened' : 'closed';
}
