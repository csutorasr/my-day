import { useState } from 'react';
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useDashboard, useIsPhone } from '../dashboard.jsx';
import { isApproval, label, nextCheck, plural, sentence } from '../format.js';
import { apiFor } from '../selection.js';
import { Gates } from './Gates.jsx';
import { Icon } from './Icon.jsx';
import { Count, Panel } from './Panel.jsx';
import { Ref } from './Ref.jsx';

// After an item leaves the inbox, keep keyboard focus in the inbox: the next item's first control,
// else the previous one's, else the heading.
function focusNext(from) {
  const row = from.closest('[data-inbox-item]');
  const targets = [...document.querySelectorAll('#needs [data-inbox-item]:not([data-queued]) :is(input, textarea, button):not([tabindex="-1"])')].filter((el) => !row?.contains(el));
  const after = targets.find((el) => row && (row.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
  (after ?? targets.at(-1) ?? document.getElementById('h-needs'))?.focus();
}

// With several loops in the inbox, each row says which workspace it belongs to.
function Workspace({ row: r }) {
  const { state: s } = useDashboard();
  if (!s.multi) return null;
  return <Badge variant="outline" data-loop-badge>{r.loopName}</Badge>;
}

const row = 'flex flex-wrap items-start gap-x-6 gap-y-3 border-b px-4 py-3.5 last:border-b-0 data-queued:bg-muted/40';
const kind = (tone) => cn('font-semibold', tone);

// A row whose action sits in the outbox: says what will happen and offers Undo until it is sent.
function Queued({ text, k }) {
  const { undo } = useDashboard();
  return (
    <div className="flex items-center gap-3" role="status">
      <span className="text-xs text-muted-foreground">{text} Sending in a few seconds.</span>
      <Button size="sm" variant="outline" onClick={() => undo(k)}>Undo</Button>
    </div>
  );
}

// A draft of an outward write (WRITES.md `ask`): what it does and where, its body editable in place.
// Approve sends the body as it stands; the loop writes exactly that.
function Draft({ q }) {
  const { state: s, queue, isQueued } = useDashboard();
  const [body, setBody] = useState(q.draft.body);
  const item = q.item ? s.items.find((i) => i.id === q.item.id && i.loop === q.loop) : null;
  const key = `q:${q.loop}:${q.id}`;
  const base = apiFor(q.loop);
  const edited = body !== q.draft.body;
  const send = (decline, el) => {
    if (!decline && !body.trim()) { el.form.elements.body.focus(); return; }
    focusNext(el);
    queue(decline
      ? { key, label: `Decline ${q.id}`, path: `${base}/questions/${q.id}/decline`, payload: {}, ok: `${q.id} declined. Nothing is written.` }
      : { key, label: `Approve ${q.id}`, path: `${base}/questions/${q.id}/answer`, payload: { text: 'approved', body }, ok: `${q.id} approved${edited ? ' with your edits' : ''}. The loop writes it within seconds.` });
  };
  return (
    <div className={row} data-inbox-item={q.id} data-loop={q.loop} data-queued={isQueued(key) || undefined} data-draft>
      <div className="flex min-w-0 flex-[1_1_100%] flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Workspace row={q} />
          <span className="font-mono text-xs text-muted-foreground">{q.id}</span>
          <Badge className={kind('bg-warning-soft text-warning')}>Draft</Badge>
          {item && <Ref item={item} actions={[]} />}
        </div>
        <p className="text-sm font-medium">{sentence(q.text)}</p>
        <span className="text-xs text-muted-foreground">
          <span className="font-mono">{q.draft.action}</span>{q.draft.target ? <> to <b className="font-medium text-foreground">{q.draft.target}</b></> : null}
        </span>
      </div>
      {isQueued(key) ? (
        <Queued k={key} text="Approval queued." />
      ) : (
        <form className="flex flex-[1_1_100%] flex-col gap-2" onSubmit={(e) => { e.preventDefault(); send(false, e.nativeEvent.submitter ?? e.currentTarget.elements.body); }}>
          <label className="sr-only" htmlFor={`d-${q.loop}-${q.id}`}>Text to write for {q.id}</label>
          <Textarea id={`d-${q.loop}-${q.id}`} name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="max-h-72 text-sm md:text-sm" />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="lg" data-primary>{edited ? 'Approve edited' : 'Approve'}</Button>
            <Button type="button" size="lg" variant="outline" data-decline onClick={(e) => send(true, e.currentTarget)}>Decline</Button>
            {edited && <Button type="button" size="lg" variant="ghost" className="text-muted-foreground" onClick={() => setBody(q.draft.body)}>Reset</Button>}
          </div>
        </form>
      )}
    </div>
  );
}

// One open question or approval. The item it is about is shown in full, so the decision can be made
// here without looking it up: title, and for an MR its merge gates.
function Ask({ q }) {
  if (q.draft) return <Draft q={q} />;
  return <Question q={q} />;
}

function Question({ q }) {
  const { state: s, queue, isQueued } = useDashboard();
  const phone = useIsPhone();
  const [text, setText] = useState('');
  const approval = isApproval(q);
  // Approvals usually mean a merge or a force-push: decide those on a larger screen.
  const blocked = approval && phone;
  const item = q.item ? s.items.find((i) => i.id === q.item.id && i.loop === q.loop) : null;
  const target = s.loops.find((l) => l.id === q.loop)?.loop.targetBranch;
  const key = `q:${q.loop}:${q.id}`;
  const base = apiFor(q.loop);
  const question = sentence(q.text.replace(/^approve:\s*/i, ''));

  const send = (decline, el) => {
    const note = text.trim();
    if (!decline && !approval && !note) { el.form.elements.text.focus(); return; }
    focusNext(el);
    queue(decline
      ? { key, label: `Decline ${q.id}`, path: `${base}/questions/${q.id}/decline`, payload: { text: note }, ok: `${q.id} declined.` }
      : { key, label: `${approval ? 'Approve' : 'Answer'} ${q.id}`, path: `${base}/questions/${q.id}/answer`, payload: { text: note || 'yes' }, ok: `${q.id} ${approval ? 'approved' : 'answered'}. The loop acts on it within seconds.` });
  };

  return (
    <div className={row} data-inbox-item={q.id} data-loop={q.loop} data-queued={isQueued(key) || undefined}>
      <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Workspace row={q} />
          <span className="font-mono text-xs text-muted-foreground">{q.id}</span>
          <Badge className={kind(approval ? 'bg-warning-soft text-warning' : 'bg-primary/10 text-link')}>{approval ? 'Approval' : 'Question'}</Badge>
          {item && <Ref item={item} actions={[]} />}
        </div>
        <p className="text-sm font-medium">{question}</p>
        {item && (
          <div className="flex flex-col gap-1.5 bg-muted px-3 py-2">
            <span className="text-xs">{item.title}</span>
            {item.type === 'mr' && <Gates mr={item} target={target} />}
          </div>
        )}
      </div>
      {isQueued(key) ? (
        <Queued k={key} text={`${approval ? 'Approval' : 'Answer'} queued.`} />
      ) : (
        <form className="flex flex-[1_1_300px] flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (!blocked) send(false, e.nativeEvent.submitter ?? e.currentTarget.elements.text); }}>
          <label className="sr-only" htmlFor={`a-${q.loop}-${q.id}`}>{approval ? 'Note for' : 'Answer'} {q.id}</label>
          <Input id={`a-${q.loop}-${q.id}`} name="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={approval ? 'Optional note' : 'Your answer'} autoComplete="off" className="h-9 min-w-40 flex-1 text-sm max-sm:h-11 md:text-sm" />
          {blocked ? (
            <span className="max-w-[22ch] text-xs text-warning">Approve from a larger screen. You can decline here.</span>
          ) : (
            <Button type="submit" size="lg" data-primary>{approval ? 'Approve' : 'Send'}</Button>
          )}
          <Button type="button" size="lg" variant="outline" data-decline onClick={(e) => send(true, e.currentTarget)}>Decline</Button>
        </form>
      )}
    </div>
  );
}

function Failure({ f }) {
  return (
    <li className={row} data-inbox-item={f.id} data-loop={f.loop}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2"><Workspace row={f} /><Badge className={kind('bg-danger-soft text-danger')}>Failed</Badge><Ref item={f} /></span>
        <span className="text-sm">{f.title}</span>
        <span className="text-xs text-danger">{f.fail_reason}</span>
        {f.hint && <span className="text-xs text-muted-foreground">{f.hint}</span>}
      </div>
    </li>
  );
}

function Review({ r }) {
  const { queue, isQueued } = useDashboard();
  const key = `review:${r.loop}:${r.id}`;
  const mark = (done, el) => {
    focusNext(el);
    queue({ key, label: `${done ? 'Mark' : 'Skip'} ${label(r)}${done ? ' reviewed' : ''}`, path: `${apiFor(r.loop)}/reviews/${r.id}/${done ? 'done' : 'skip'}`, ok: `${label(r)} ${done ? 'marked reviewed' : 'skipped'}.` });
  };
  return (
    <li className={cn(row, 'items-center')} data-inbox-item={r.id} data-loop={r.loop} data-queued={isQueued(key) || undefined}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2"><Workspace row={r} /><Badge className={kind('bg-muted text-foreground')}>Review</Badge><Ref item={r} actions={[]} /></span>
        <span className="text-sm">{r.title}</span>
      </div>
      {isQueued(key) ? (
        <Queued k={key} text="Marked." />
      ) : (
        <span className="flex gap-1">
          <Button size="sm" variant="outline" data-primary aria-label={`Mark ${label(r)} reviewed`} onClick={(e) => mark(true, e.currentTarget)}>Done</Button>
          <Button size="sm" variant="ghost" className="text-muted-foreground" data-decline aria-label={`Skip ${label(r)}`} onClick={(e) => mark(false, e.currentTarget)}>Skip</Button>
        </span>
      )}
    </li>
  );
}

// Everything that waits for the user in one place: decisions, failures and review requests.
export function NeedsYou() {
  const { state: s } = useDashboard();
  const count = s ? s.questions.length + s.failed.length + s.reviews.length : 0;
  let body;
  if (!s) {
    body = <div className="flex flex-col gap-2 p-4"><Skeleton className="h-4 w-2/5" /><Skeleton className="h-4 w-4/5" /></div>;
  } else if (!count) {
    const nxt = s.multi ? '' : nextCheck(s.loop);
    body = (
      <div className="flex items-center gap-4 px-4 py-6">
        <span className="grid size-10 shrink-0 place-items-center bg-success-soft text-success"><Icon icon={CheckmarkCircle02Icon} className="size-5" /></span>
        <div className="flex flex-col gap-0.5">
          <b className="text-sm font-semibold">Nothing needs you right now.</b>
          <span className="text-xs text-muted-foreground">
            {!s.multi && s.loop.paused ? 'The loop is paused. Resume it from the header.' : nxt ? `${nxt}. Decisions, failures and reviews show up here.` : 'Decisions, failures and reviews show up here.'}
          </span>
        </div>
      </div>
    );
  } else {
    const group = 'border-b last:border-b-0';
    body = (
      <>
        {s.questions.length > 0 && (
          <div className={group} role="group" aria-label="Decisions">{s.questions.map((q) => <Ask key={`${q.loop}:${q.id}`} q={q} />)}</div>
        )}
        {s.failed.length > 0 && (
          <ul className={group} aria-label="Failures">{s.failed.map((f) => <Failure key={`${f.loop}:${f.id}`} f={f} />)}</ul>
        )}
        {s.reviews.length > 0 && (
          <ul className={group} aria-label="Reviews for you">{s.reviews.map((r) => <Review key={`${r.loop}:${r.id}`} r={r} />)}</ul>
        )}
      </>
    );
  }
  const parts = s ? [plural(s.questions.length, 'decision'), plural(s.failed.length, 'failure'), plural(s.reviews.length, 'review')].filter((p) => !p.startsWith('0 ')) : [];
  return (
    <Panel
      id="needs"
      titleId="h-needs"
      title="Needs you"
      extra={(
        <>
          <Count n={count} tone="warn" label={count ? `${plural(count, 'item')} waiting` : undefined} />
          <span className="text-xs text-muted-foreground">{parts.length ? `${parts.join(' · ')}. ` : ''}Every action can be undone for a few seconds.<span className="max-sm:hidden"> Press ? for shortcuts.</span></span>
        </>
      )}
    >
      <div>{body}</div>
    </Panel>
  );
}
