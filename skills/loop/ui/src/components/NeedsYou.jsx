import { useState } from 'react';
import { useDashboard } from '../dashboard.jsx';
import { isApproval, nextCheck, sentence } from '../format.js';
import { CheckIcon } from './Icons.jsx';
import { Ref } from './Ref.jsx';

// One open question or approval, answerable (or declinable) right here.
function Ask({ q }) {
  const { state: s, act } = useDashboard();
  const [text, setText] = useState('');
  const approval = isApproval(q);
  const item = q.item ? s.items.find((i) => i.id === q.item.id) : null;

  const submit = (e) => {
    e.preventDefault();
    const answer = text.trim() || (approval ? 'yes' : '');
    if (!answer) { e.currentTarget.elements.text.focus(); return; }
    act(`/api/questions/${q.id}/answer`, { text: answer }, `${q.id} answered. The loop acts on it shortly.`);
  };

  return (
    <div className="ask">
      <div className="main">
        <div className="meta">
          <span className="mono muted small">{q.id}</span>
          <span className={`kind${approval ? ' approval' : ''}`}>{approval ? 'Approval' : 'Question'}</span>
          {item && <Ref item={item} actions={[]} />}
        </div>
        <div className="text">{sentence(q.text.replace(/^approve:\s*/i, ''))}</div>
      </div>
      <form onSubmit={submit}>
        <label className="sr-only" htmlFor={`a-${q.id}`}>Answer {q.id}</label>
        <input type="text" id={`a-${q.id}`} name="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={approval ? 'Optional note' : 'Your answer'} autoComplete="off" />
        <button className="btn primary" type="submit">{approval ? 'Approve' : 'Send'}</button>
        <button className="btn" type="button" onClick={() => act(`/api/questions/${q.id}/decline`, null, `${q.id} declined`)}>Decline</button>
      </form>
    </div>
  );
}

export function NeedsYou() {
  const { state: s } = useDashboard();
  let body;
  if (!s) {
    body = <div className="ask"><div className="main"><span className="skel" style={{ width: '40%' }} /><span className="skel" style={{ width: '80%' }} /></div></div>;
  } else if (s.questions.length) {
    body = s.questions.map((q) => <Ask key={q.id} q={q} />);
  } else {
    const nxt = nextCheck(s.loop);
    body = (
      <div className="calm">
        <span className="mark" aria-hidden="true"><CheckIcon /></span>
        <div>
          <b>Nothing needs you right now.</b>
          <span className="muted small">
            {s.loop.paused ? 'The loop is paused. Resume it from the header.' : nxt ? `${nxt}. New questions show up here.` : 'New questions show up here.'}
          </span>
        </div>
      </div>
    );
  }
  return (
    <section className="panel" id="needs" aria-labelledby="h-needs">
      <div className="head">
        <h2 id="h-needs">Needs you</h2>
        <span className="count warn">{s?.questions.length || ''}</span>
        <span className="muted small">Answer here or in the session. The loop picks it up within seconds.</span>
      </div>
      <div>{body}</div>
    </section>
  );
}
