// Merge-gate verdict from forge `mr` details. Workspace-specific extra gates
// (dependency MRs, pre-release SDKs, trains) are checked by the orchestrator per MERGE-GATES.md
// when the verdict is `merge`.
export function verdict(d, { targetBranch = 'main' } = {}) {
  const failing = [];
  if (d.target !== targetBranch) return { action: 'wait', failing: [`target is ${d.target}, not ${targetBranch}`] };
  if (d.draft) failing.push('draft');
  if (!d.approved) failing.push('not approved');
  if (d.unresolved.length) failing.push(`${d.unresolved.length} unresolved thread(s)`);
  const p = d.pipeline?.status ?? null;
  if (p !== 'success') failing.push(`pipeline ${p ?? 'missing'}`);
  if (d.hasConflicts || d.mergeStatus === 'conflict') failing.push('conflicts');
  else if (d.mergeStatus === 'need_rebase') failing.push('behind target');

  let action;
  if (d.rebaseInProgress) action = 'wait';
  else if (d.unresolved.length && !d.approved) action = 'fix-review';
  else if (p === 'failed') action = 'fix-pipeline';
  else if (d.hasConflicts || ['conflict', 'need_rebase'].includes(d.mergeStatus)) action = d.draft ? 'wait' : 'rebase';
  else if (!failing.length && d.mergeStatus === 'mergeable') action = 'merge';
  else if (d.unresolved.length) action = 'fix-review';
  else action = 'wait';
  return { action, failing };
}
