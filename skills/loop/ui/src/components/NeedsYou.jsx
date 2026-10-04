import { useState } from 'react';
import { useDashboard } from '../dashboard.jsx';
import { isApproval, label, nextCheck, plural, sentence } from '../format.js';
import { Gates } from './Gates.jsx';
import { CheckIcon } from './Icons.jsx';
import { Ref } from './Ref.jsx';

// After an item leaves the inbox, keep keyboard focus in the inbox: the next item's first control,
// else the previous one's, else the heading.
function focusNext(from) {
  const row = from.closest('.ask, li');
  const targets = [...document.querySelectorAll('#needs .ask input, #needs li .btns button, #needs li .act')].filter((el) => !row?.contains(el));
  const after = targets.find((el) => row && (row.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
  (after ?? targets.at(-1) ?? document.getElementById('h-needs'))?.focus();
}

// A row whose action sits in the outbox: says what will happen and offers Undo until it is sent.
function Queued({ text, k }) {
  const { undo } = useDashboard();
  return (
    <div className="queued-row" role="status">
      <span className="muted small">{text} Sending in a few seconds.</span>
      <button type="button" className="btn small" onClick={() => undo(k)}>Undo</button>
    </div>
  );
}

// One open question or approval. The item it is about is shown in full, so the decision can be made
// here without looking it up: title, and for an MR its merge gates.
function Ask({ q }) {
  const { state: s, queue, isQueued } = useDashboard();
  const [text, setText] = useState('');
  const approval = isApproval(q);
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
    <div className="ask">
      <div className="main">
        <div className="meta">
          <span className="mono muted small">{q.id}</span>
          <span className={`kind${approval ? ' approval' : ''}`}>{approval ? 'Approval' : 'Question'}</span>
          {item && <Ref item={item} actions={[]} />}
        </div>
        <div className="text">{question}</div>
        {item && (
          <div className="context">
            <span className="small">{item.title}</span>
            {item.type === 'mr' && <Gates mr={item} target={s.loop.targetBranch} />}
          </div>
        )}
      </div>
      {isQueued(key) ? (
        <Queued k={key} text={`${approval ? 'Approval' : 'Answer'} queued.`} />
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); send(false, e.nativeEvent.submitter ?? e.currentTarget.elements.text); }}>
          <label className="sr-only" htmlFor={`a-${q.id}`}>{approval ? 'Note for' : 'Answer'} {q.id}</label>
          <input type="text" id={`a-${q.id}`} name="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={approval ? 'Optional note' : 'Your answer'} autoComplete="off" />
          <button className="btn primary" type="submit">{approval ? 'Approve' : 'Send'}</button>
          <button className="btn" type="button" onClick={(e) => send(true, e.currentTarget)}>Decline</button>
        </form>
      )}
    </div>
  );
}

function Failure({ f }) {
  return (
    <li>
      <div className="main">
        <span className="row-head"><span className="kind bad">Failed</span><Ref item={f} /></span>
        <span className="t">{f.title}</span>
        <span className="reason">{f.fail_reason}</span>
        {f.hint && <span className="muted small">{f.hint}</span>}
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
    <li>
      <div className="main">
        <span className="row-head"><span className="kind">Review</span><Ref item={r} actions={[]} /></span>
        <span className="t">{r.title}</span>
      </div>
      {isQueued(key) ? (
        <Queued k={key} text="Marked." />
      ) : (
        <span className="btns">
          <button type="button" className="btn small" aria-label={`Mark ${label(r)} reviewed`} onClick={(e) => mark(true, e.currentTarget)}>Done</button>
          <button type="button" className="btn small ghost" aria-label={`Skip ${label(r)}`} onClick={(e) => mark(false, e.currentTarget)}>Skip</button>
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
    body = <div className="ask"><div className="main"><span className="skel" style={{ width: '40%' }} /><span className="skel" style={{ width: '80%' }} /></div></div>;
  } else if (!count) {
    const nxt = nextCheck(s.loop);
    body = (
      <div className="calm">
        <span className="mark" aria-hidden="true"><CheckIcon /></span>
        <div>
          <b>Nothing needs you right now.</b>
          <span className="muted small">
            {s.loop.paused ? 'The loop is paused. Resume it from the header.' : nxt ? `${nxt}. Decisions, failures and reviews show up here.` : 'Decisions, failures and reviews show up here.'}
          </span>
        </div>
      </div>
    );
  } else {
    body = (
      <>
        {s.questions.length > 0 && (
          <div className="group" aria-label="Decisions">{s.questions.map((q) => <Ask key={q.id} q={q} />)}</div>
        )}
        {s.failed.length > 0 && (
          <ul className="rows group" aria-label="Failures">{s.failed.map((f) => <Failure key={f.id} f={f} />)}</ul>
        )}
        {s.reviews.length > 0 && (
          <ul className="rows group" aria-label="Reviews for you">{s.reviews.map((r) => <Review key={r.id} r={r} />)}</ul>
        )}
      </>
    );
  }
  const parts = s ? [plural(s.questions.length, 'decision'), plural(s.failed.length, 'failure'), plural(s.reviews.length, 'review')].filter((p) => !p.startsWith('0 ')) : [];
  return (
    <section className="panel" id="needs" aria-labelledby="h-needs">
      <div className="head">
        <h2 id="h-needs" tabIndex={-1}>Needs you</h2>
        <span className={`count${count ? ' warn' : ''}`}>{count || ''}</span>
        <span className="muted small">{parts.length ? `${parts.join(' · ')}. ` : ''}Every action can be undone for a few seconds.</span>
      </div>
      <div>{body}</div>
    </section>
  );
}
