import { useState } from 'react';
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useDashboard, useIsPhone } from '../dashboard.jsx';
import { isApproval, label, nextCheck, plural, sentence } from '../format.js';
import { Gates } from './Gates.jsx';
import { Icon } from './Icon.jsx';
import { Count, Panel } from './Panel.jsx';
import { Ref } from './Ref.jsx';

// After an item leaves the inbox, keep keyboard focus in the inbox: the next item's first control,
// else the previous one's, else the heading.
function focusNext(from) {
  const row = from.closest('[data-inbox-item]');
  const targets = [...document.querySelectorAll('#needs [data-inbox-item]:not([data-queued]) :is(input, button):not([tabindex="-1"])')].filter((el) => !row?.contains(el));
  const after = targets.find((el) => row && (row.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
  (after ?? targets.at(-1) ?? document.getElementById('h-needs'))?.focus();
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

// One open question or approval. The item it is about is shown in full, so the decision can be made
// here without looking it up: title, and for an MR its merge gates.
function Ask({ q }) {
  const { state: s, queue, isQueued } = useDashboard();
  const phone = useIsPhone();
  const [text, setText] = useState('');
  const approval = isApproval(q);
  // Approvals usually mean a merge or a force-push: decide those on a larger screen.
  const blocked = approval && phone;
  const item = q.item ? s.items.find((i) => i.id === q.item.id) : null;
  const key = `q:${q.id}`;
  const question = sentence(q.text.replace(/^approve:\s*/i, ''));

  const send = (decline, el) => {
    const note = text.trim();
    if (!decline && !approval && !note) { el.form.elements.text.focus(); return; }
    focusNext(el);
    queue(decline
      ? { key, label: `Decline ${q.id}`, path: `/api/questions/${q.id}/decline`, payload: { text: note }, ok: `${q.id} declined.` }
      : { key, label: `${approval ? 'Approve' : 'Answer'} ${q.id}`, path: `/api/questions/${q.id}/answer`, payload: { text: note || 'yes' }, ok: `${q.id} ${approval ? 'approved' : 'answered'}. The loop acts on it within seconds.` });
  };

  return (
    <div className={row} data-inbox-item={q.id} data-queued={isQueued(key) || undefined}>
      <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{q.id}</span>
          <Badge className={kind(approval ? 'bg-warning-soft text-warning' : 'bg-primary/10 text-link')}>{approval ? 'Approval' : 'Question'}</Badge>
          {item && <Ref item={item} actions={[]} />}
        </div>
        <p className="text-sm font-medium">{question}</p>
        {item && (
          <div className="flex flex-col gap-1.5 bg-muted px-3 py-2">
            <span className="text-xs">{item.title}</span>
            {item.type === 'mr' && <Gates mr={item} target={s.loop.targetBranch} />}
          </div>
        )}
      </div>
      {isQueued(key) ? (
        <Queued k={key} text={`${approval ? 'Approval' : 'Answer'} queued.`} />
      ) : (
        <form className="flex flex-[1_1_300px] flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (!blocked) send(false, e.nativeEvent.submitter ?? e.currentTarget.elements.text); }}>
          <label className="sr-only" htmlFor={`a-${q.id}`}>{approval ? 'Note for' : 'Answer'} {q.id}</label>
          <Input id={`a-${q.id}`} name="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={approval ? 'Optional note' : 'Your answer'} autoComplete="off" className="h-9 min-w-40 flex-1 text-sm max-sm:h-11 md:text-sm" />
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
    <li className={row} data-inbox-item={f.id}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2"><Badge className={kind('bg-danger-soft text-danger')}>Failed</Badge><Ref item={f} /></span>
        <span className="text-sm">{f.title}</span>
        <span className="text-xs text-danger">{f.fail_reason}</span>
        {f.hint && <span className="text-xs text-muted-foreground">{f.hint}</span>}
      </div>
    </li>
  );
}

function Review({ r }) {
  const { queue, isQueued } = useDashboard();
  const key = `review:${r.id}`;
  const mark = (done, el) => {
    focusNext(el);
    queue({ key, label: `${done ? 'Mark' : 'Skip'} ${label(r)}${done ? ' reviewed' : ''}`, path: `/api/reviews/${r.id}/${done ? 'done' : 'skip'}`, ok: `${label(r)} ${done ? 'marked reviewed' : 'skipped'}.` });
  };
  return (
    <li className={cn(row, 'items-center')} data-inbox-item={r.id} data-queued={isQueued(key) || undefined}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2"><Badge className={kind('bg-muted text-foreground')}>Review</Badge><Ref item={r} actions={[]} /></span>
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
    const nxt = nextCheck(s.loop);
    body = (
      <div className="flex items-center gap-4 px-4 py-6">
        <span className="grid size-10 shrink-0 place-items-center bg-success-soft text-success"><Icon icon={CheckmarkCircle02Icon} className="size-5" /></span>
        <div className="flex flex-col gap-0.5">
          <b className="text-sm font-semibold">Nothing needs you right now.</b>
          <span className="text-xs text-muted-foreground">
            {s.loop.paused ? 'The loop is paused. Resume it from the header.' : nxt ? `${nxt}. Decisions, failures and reviews show up here.` : 'Decisions, failures and reviews show up here.'}
          </span>
        </div>
      </div>
    );
  } else {
    const group = 'border-b last:border-b-0';
    body = (
      <>
        {s.questions.length > 0 && (
          <div className={group} role="group" aria-label="Decisions">{s.questions.map((q) => <Ask key={q.id} q={q} />)}</div>
        )}
        {s.failed.length > 0 && (
          <ul className={group} aria-label="Failures">{s.failed.map((f) => <Failure key={f.id} f={f} />)}</ul>
        )}
        {s.reviews.length > 0 && (
          <ul className={group} aria-label="Reviews for you">{s.reviews.map((r) => <Review key={r.id} r={r} />)}</ul>
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
