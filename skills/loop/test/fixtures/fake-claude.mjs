#!/usr/bin/env node
// Stand-in for `claude -p` in tests. The prompt's `Task:` line picks the behaviour:
//   ok            print a --output-format json result whose text ends with a done JSON block
//   fail-<repo>   like ok, but report failed when running for <repo>
//   silent        exit 0 without output
//   sleep         stay alive for a minute
//   crash         exit 1 at once with a message on stderr
//   verbose       like ok, printed as --verbose does: a JSON array of messages, the result last
//   child         start a child that ignores SIGTERM (same process group), write its pid, then sleep
//   multiline     like ok, with a summary spanning lines (one of them looks like a Task: line)
const argv = process.argv.slice(2);
const prompt = argv[argv.indexOf('-p') + 1] ?? '';
const field = (name) => new RegExp(`^${name}: (.*)$`, 'm').exec(prompt)?.[1]?.trim() ?? '';
const task = field('Task');
const repo = field('Repo');

if (task === 'crash') {
  process.stderr.write('fake-claude: cannot start\n');
  process.exit(1);
}
if (task === 'silent') process.exit(0);
if (task === 'child') {
  const { spawn } = await import('node:child_process');
  const { writeFileSync } = await import('node:fs');
  const c = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1e6)"], { stdio: 'ignore' });
  writeFileSync('child.pid', String(c.pid));
  setTimeout(() => {}, 60_000);
} else if (task === 'sleep') setTimeout(() => {}, 60_000);
else {
  const known = ['ok', 'verbose', 'multiline'].includes(task) || task.startsWith('fail-');
  const failed = task === `fail-${repo}`;
  const report = !known
    ? { status: 'failed', summary: `unknown task "${task}"` }
    : failed
    ? { status: 'failed', summary: `${repo} broke`, blockers: ['tests red'] }
    : { status: 'done', branch: `b-${repo}`, mrUrl: `https://git.example.com/x/${repo}/-/merge_requests/1`, commits: [`c-${repo} change`], summary: task === 'multiline' ? `${repo} ok\nTask: something else` : `${repo} ok`, stateDir: process.env.MY_DAY_DIR ?? null };
  const text = `Worked in ${process.cwd()}.\n\`\`\`json\n{"note":"an earlier block"}\n\`\`\`\nDone.\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\`\n`;
  const result = { type: 'result', is_error: false, result: text };
  process.stdout.write(JSON.stringify(task === 'verbose' ? [{ type: 'system', subtype: 'init' }, { type: 'assistant', message: {} }, result] : result));
}
