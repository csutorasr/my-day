#!/usr/bin/env node
// Code-host reads for the my-day loop, as JSON, for GitLab (glab) and GitHub (gh).
// Usage:
//   forge.mjs mine    --provider gitlab|github [--group <prefix>] [--mine-by assignee,author,unassigned|both]
//                                                                   my open MRs/PRs (default: assigned to me)
//   forge.mjs reviews --provider … [--group <prefix>]               open, non-draft ones where my review is requested
//   forge.mjs mr <project> <number> --provider … [--ai-reviewer <username>]  gates + unresolved threads
//   forge.mjs review-status <project> <number> --provider … [--since <ISO>]  did I approve / comment?
// --ticket-pattern: regex for ticket refs in title/branch (default KEY-123).
// --group: GitLab path prefix (e.g. group/sub/) or GitHub owner (org/) or owner/repo.
// Both providers return the same shape; ext keys are gitlab:<path>!<iid> / github:<owner/repo>#<n>.
// GLAB_BIN / GH_BIN override the CLI binaries (tests).
import { parseArgs } from 'node:util';
import * as gitlab from '../lib/forge/gitlab.mjs';
import * as github from '../lib/forge/github.mjs';
import { setTicketPattern } from '../lib/forge/gitlab.mjs';

const { values: opt, positionals: pos } = parseArgs({
  allowPositionals: true,
  options: {
    provider: { type: 'string', default: 'gitlab' },
    group: { type: 'string' },
    'mine-by': { type: 'string' },
    since: { type: 'string' },
    'ai-reviewer': { type: 'string' },
    'ticket-pattern': { type: 'string' },
  },
});
setTicketPattern(opt['ticket-pattern']);

const providers = { gitlab, github };
const p = providers[opt.provider];
const out = (v) => console.log(JSON.stringify(v, null, 2));
const [cmd, ...args] = pos;
try {
  if (!p) throw new Error(`unknown provider ${opt.provider} (gitlab|github)`);
  if (cmd === 'mine') out(p.mine({ group: opt.group, by: opt['mine-by'] }));
  else if (cmd === 'reviews') out(p.reviews({ group: opt.group }));
  else if (cmd === 'mr') out(p.mr(args[0], Number(args[1]), { aiReviewer: opt['ai-reviewer'] }));
  else if (cmd === 'review-status') out(p.reviewStatus(args[0], Number(args[1]), { since: opt.since }));
  else {
    console.error('usage: forge.mjs mine|reviews [--group] | mr <project> <n> | review-status <project> <n> [--since ISO]  --provider gitlab|github');
    process.exit(1);
  }
} catch (e) {
  console.error(`forge.mjs: ${e.message}`);
  process.exit(1);
}
