// LOOP.md `mineBy`: which open MRs/PRs the loop treats as mine, as a comma-separated list of
//   assignee    assigned to me (the default)
//   author      opened by me
//   unassigned  nobody assigned, mine or not (e.g. a bot's dependency updates) — needs `group`
// `both` is short for `author, assignee`. Each provider maps the terms to its own queries.
const TERMS = ['assignee', 'author', 'unassigned'];
const ALIASES = { both: ['author', 'assignee'] };

export function mineTerms(by, group) {
  const raw = String(by ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const terms = [...new Set((raw.length ? raw : ['assignee']).flatMap((t) => ALIASES[t] ?? [t]))];
  const bad = terms.find((t) => !TERMS.includes(t));
  if (bad) throw new Error(`unknown mineBy ${bad} (assignee | author | unassigned | both, comma-separated)`);
  // Without a group, "nobody assigned" would be every open MR/PR the account can see.
  if (terms.includes('unassigned') && !group) throw new Error('mineBy unassigned needs a group (LOOP.md `group`)');
  return terms;
}
