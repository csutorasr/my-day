const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hhmm = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
// Time, prefixed with the day when it is not today ("Oct 1, 18:14").
const when = (ts) => (new Date(ts).toDateString() === new Date().toDateString() ? hhmm(ts) : `${new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${hhmm(ts)}`);
let range = { today: '1' };
let last = null;

const ICON = {
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"></path><path d="M20 4 10 14"></path><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"></path></svg>',
};

// Quick actions the loop understands (server REQUESTS); labels per action.
const ACTION_LABEL = { rebase: 'Rebase', 'fix-pipeline': 'Fix pipeline', 'fix-review': 'Fix review', merge: 'Merge step', retry: 'Retry', elaborate: 'Ask why' };
const VERDICT_ACTION = { rebase: 'rebase', 'fix-pipeline': 'fix-pipeline', 'fix-review': 'fix-review', merge: 'merge' };

const repoOf = (i) => (i?.data?.project ?? i?.project ?? '').split('/').at(-1);
function label(i) {
  if (!i) return '';
  const iid = i.data?.iid ?? i.iid;
  if ((i.type === 'mr' || i.type === 'review') && iid) return `${repoOf(i)} !${iid}`;
  const key = (i.ext_key ?? '').split(':').slice(1).join(':');
  return key || i.id;
}

// Actions offered on an item reference, most useful first.
function actionsFor(i) {
  if (!i || !last) return [];
  if (i.type === 'review') return [];
  const acts = [];
  if (i.failed) acts.push('retry');
  const v = VERDICT_ACTION[i.data?.verdict];
  if (i.type === 'mr' && v && !i.agent_id) acts.push(v);
  if (!acts.length) acts.push('elaborate');
  return acts.filter((a) => last.requests.includes(a));
}

// Requests sent from the dashboard that the loop has not picked up yet.
function pendingRequests() {
  const since = last?.loop.lastTickAt ?? '';
  const out = new Set();
  for (const e of last?.recent ?? []) if (e.kind === 'dashboard-request' && e.ts > since) out.add(`${e.item_id}:${e.data?.action}`);
  return out;
}

// Every reference to an MR, ticket or link carries its quick actions: copy, open, and the loop action.
function ref(i, { text, url, actions } = {}) {
  const href = url ?? i?.url;
  const name = text ?? label(i);
  if (!href && !i) return '';
  const pend = pendingRequests();
  const acts = (actions ?? actionsFor(i)).map((a) => {
    const sent = pend.has(`${i.id}:${a}`);
    return `<button type="button" class="act${sent ? ' sent' : ''}" data-request="${esc(a)}" data-item="${esc(i.id)}" ${sent ? 'disabled' : ''} title="Ask the loop to ${esc(ACTION_LABEL[a].toLowerCase())} on its next tick">${sent ? `${esc(ACTION_LABEL[a])} requested` : esc(ACTION_LABEL[a])}</button>`;
  }).join('');
  const link = href
    ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(name)}</a>
       <button type="button" class="qa" data-copy="${esc(href)}" aria-label="Copy link to ${esc(name)}" title="Copy link">${ICON.copy}</button>
       <a class="qa" href="${esc(href)}" target="_blank" rel="noopener" aria-label="Open ${esc(name)} in a new tab" title="Open">${ICON.open}</a>`
    : `<span class="mono small">${esc(name)}</span>`;
  return `<span class="ref">${link}${acts}</span>`;
}

// Extra links on an item, newest per kind (a pipeline link is added on every run; only the latest matters).
const linkRefs = (i) => {
  const latest = new Map();
  for (const l of i.links ?? []) if (l.url !== i.url && l.kind !== 'mr') latest.set(l.kind, l);
  return [...latest.values()].map((l) => ref(i, { text: l.label ?? l.kind, url: l.url, actions: [] })).join('');
};
const sentence = (t) => t.charAt(0).toUpperCase() + t.slice(1);
// Gate reasons from the verdict, phrased for people.
const humanFailing = (f) => f.map((x) => x.replace(/^target is (\S+), not \S+$/, 'targets $1 (outside the merge step)')).join(', ');

function gates(m, target) {
  const d = m.data ?? {};
  const out = [];
  if (d.draft) out.push(['draft', '']);
  const p = d.pipeline?.status;
  out.push(p === 'success' ? ['pipeline green', 'ok'] : p === 'failed' ? ['pipeline failed', 'bad'] : p ? [`pipeline ${p}`, 'wait'] : ['no pipeline', '']);
  const n = (d.approvedBy ?? []).length;
  out.push([`${n} approved`, n ? 'ok' : 'wait']);
  const t = (d.unresolved ?? []).length;
  if (t) out.push([`${t} thread${t > 1 ? 's' : ''}`, 'wait']);
  if (d.mergeStatus === 'conflict') out.push(['conflicts', 'bad']);
  else if (d.mergeStatus === 'need_rebase') out.push(['behind target', 'wait']);
  if (d.target && d.target !== target) out.push([`→ ${d.target}`, '']);
  return `<div class="gates">${out.map(([l, c]) => `<span class="g ${c}">${esc(l)}</span>`).join('')}</div>`;
}

const NEXT = { merge: 'Ready for the merge step', rebase: 'Needs a rebase', 'fix-pipeline': 'Pipeline failed', 'fix-review': 'Review comments to handle' };

function render(s) {
  last = s;
  const CLOSED = new Set(s.closedStatuses);
  const qByItem = new Map(s.questions.filter((q) => q.item_id).map((q) => [q.item_id, q]));
  const open = s.items.filter((i) => !CLOSED.has(i.status));
  const mrs = open.filter((i) => i.type === 'mr');
  const running = s.items.filter((i) => i.agent_id);

  // Header
  $('#dir').textContent = s.dir.split('/').slice(-2, -1)[0] ?? s.dir;
  $('#mode').textContent = s.dryRun ? 'Dry run' : 'Live';
  $('#mode').className = `chip ${s.dryRun ? 'warn' : 'accent'}`;
  $('#paused').hidden = !s.loop.paused;
  $('#pause').textContent = s.loop.paused ? 'Resume loop' : 'Pause loop';
  $('#hours').textContent = `Working hours ${s.loop.workingHours}`;
  const nxt = s.loop.nextTickAt && new Date(s.loop.nextTickAt) > new Date() ? `Next check ${when(s.loop.nextTickAt)}` : s.loop.lastTickAt ? `Last check ${when(s.loop.lastTickAt)}` : '';
  $('#next').hidden = !nxt;
  $('#next').textContent = nxt;

  // Needs you
  const approvals = s.questions.filter((q) => /^approve\b/i.test(q.text)).length;
  $('#c-needs').textContent = s.questions.length || '';
  $('#t-needs').textContent = s.questions.length;
  $('#t-needs-s').textContent = s.questions.length ? `${approvals} approval${approvals === 1 ? '' : 's'} · ${s.questions.length - approvals} question${s.questions.length - approvals === 1 ? '' : 's'}` : 'nothing waiting';
  $('#asks').innerHTML = s.questions.length
    ? s.questions.map((q) => {
        const approval = /^approve\b/i.test(q.text);
        const item = q.item ? s.items.find((i) => i.id === q.item.id) : null;
        return `<div class="ask">
          <div class="main">
            <div class="meta"><span class="mono muted small">${esc(q.id)}</span><span class="kind${approval ? ' approval' : ''}">${approval ? 'Approval' : 'Question'}</span>${item ? ref(item, { actions: [] }) : ''}</div>
            <div class="text">${esc(sentence(q.text.replace(/^approve:\s*/i, '')))}</div>
          </div>
          <form data-question="${esc(q.id)}" data-approval="${approval}">
            <label class="sr-only" for="a-${esc(q.id)}">Answer ${esc(q.id)}</label>
            <input type="text" id="a-${esc(q.id)}" name="text" placeholder="${approval ? 'Optional note' : 'Your answer'}" autocomplete="off">
            <button class="btn primary" type="submit">${approval ? 'Approve' : 'Send'}</button>
            <button class="btn" type="button" data-decline="${esc(q.id)}">Decline</button>
          </form>
        </div>`;
      }).join('')
    : `<div class="calm"><span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17 19 7"></path></svg></span>
        <div><b>Nothing needs you right now.</b><span class="muted small">${s.loop.paused ? 'The loop is paused. Resume it from the header.' : nxt ? `${esc(nxt)}. New questions show up here.` : 'New questions show up here.'}</span></div></div>`;

  // Failures (items the loop gave up on)
  $('#failures').hidden = !s.failed.length;
  $('#c-failed').textContent = s.failed.length || '';
  $('#failed').innerHTML = s.failed.map((f) => `<li><div class="main">${ref(f)}<span class="t">${esc(f.title)}</span><span class="reason">${esc(f.fail_reason)}</span>${f.hint ? `<span class="muted small">${esc(f.hint)}</span>` : ''}</div></li>`).join('');

  // MR board
  const lanes = [
    { key: 'you', title: 'Needs you', dot: 'warn', none: 'Nothing blocked on you', items: [] },
    { key: 'agent', title: 'Agent working', dot: 'accent', none: 'No agents running', items: [] },
    { key: 'wait', title: 'Waiting', dot: '', none: 'Nothing waiting', items: [] },
    { key: 'ready', title: 'Ready', dot: 'ok', none: 'Nothing ready yet', items: [] },
  ];
  const lane = Object.fromEntries(lanes.map((l) => [l.key, l]));
  for (const m of mrs) {
    if (m.agent_id) lane.agent.items.push(m);
    else if (qByItem.has(m.id) || m.failed || m.status === 'blocked') lane.you.items.push(m);
    else if (m.data?.verdict === 'merge') lane.ready.items.push(m);
    else lane.wait.items.push(m);
  }
  $('#t-mrs').textContent = mrs.length;
  $('#t-mrs-s').textContent = `${lane.you.items.length} need you · ${lane.wait.items.length} waiting`;
  $('#mrs-sub').textContent = `${mrs.length} open · grouped by what they wait for`;
  $('#board').innerHTML = lanes.map((l) => `<div class="lane">
      <div class="title"><span class="dot ${l.dot}"></span>${esc(l.title)} <span class="n">${l.items.length}</span></div>
      ${l.items.length ? l.items.map((m) => {
        const q = qByItem.get(m.id);
        const ticket = m.data?.ticketKeys?.[0];
        const nextText = q ? `Waiting for you · ${q.id}` : m.agent_id ? `Agent ${m.agent_id} working` : NEXT[m.data?.verdict] ?? (humanFailing(m.data?.failing ?? []) || 'Waiting');
        return `<div class="card">
          <div class="top">${ref(m)}${ticket ? `<span class="mono muted tiny">${esc(ticket)}</span>` : ''}</div>
          <div class="t">${esc(m.title)}</div>
          ${gates(m, s.loop.targetBranch)}
          ${linkRefs(m) ? `<div class="links">${linkRefs(m)}</div>` : ''}
          <div class="next${q ? ' warn' : ''}">${esc(nextText)}</div>
        </div>`;
      }).join('') : `<div class="none">${esc(l.none)}</div>`}
    </div>`).join('');

  // Tickets
  const tickets = open.filter((i) => !['mr', 'review'].includes(i.type));
  const closedTickets = s.items.filter((i) => CLOSED.has(i.status) && !['mr', 'review'].includes(i.type));
  $('#c-tickets').textContent = tickets.length || '';
  $('#tickets').innerHTML = tickets.length
    ? tickets.map((i) => `<li><div class="main">${ref(i)}<span class="t">${esc(i.title)}</span>${[i.branch, i.repos?.join(', '), i.attempts ? `attempts ${i.attempts}` : ''].filter(Boolean).length ? `<span class="muted small">${esc([i.branch, i.repos?.join(', '), i.attempts ? `attempts ${i.attempts}` : ''].filter(Boolean).join(' · '))}</span>` : ''}</div><span class="status">${esc(i.status)}</span></li>`).join('')
    : '<li class="empty">No open tickets in scope.</li>';
  $('#closed-wrap').hidden = !closedTickets.length;
  $('#closed-wrap summary').textContent = `Closed (${closedTickets.length})`;
  $('#closed').innerHTML = closedTickets.map((i) => `<li><div class="main">${ref(i, { actions: [] })}<span class="t">${esc(i.title)}</span></div><span class="status">${esc(i.status)}</span></li>`).join('');

  // Reviews
  const repos = new Set(s.reviews.map((r) => repoOf(r)));
  $('#c-reviews').textContent = s.reviews.length || '';
  $('#t-reviews').textContent = s.reviews.length;
  $('#t-reviews-s').textContent = s.reviews.length ? `across ${repos.size} repo${repos.size === 1 ? '' : 's'}` : 'all caught up';
  $('#review-list').innerHTML = s.reviews.length
    ? s.reviews.map((r) => `<li><div class="main">${ref(r, { actions: [] })}<span class="t">${esc(r.title)}</span></div>
        <span class="btns"><button type="button" class="btn small" data-review="${esc(r.id)}" data-act="done" aria-label="Mark ${esc(label(r))} reviewed">Done</button>
        <button type="button" class="btn small ghost" data-review="${esc(r.id)}" data-act="skip" aria-label="Skip ${esc(label(r))}">Skip</button></span></li>`).join('')
    : '<li class="empty">Nothing to review.</li>';

  // Agents
  const max = s.loop.maxAgents || 3;
  $('#t-agents').textContent = `${running.length}/${max}`;
  $('#t-agents-s').textContent = `${s.finishedToday.length} finished today`;
  $('#slots-txt').textContent = `${running.length} of ${max} slots busy`;
  $('#slots').style.gridTemplateColumns = `repeat(${max}, minmax(0, 1fr))`;
  $('#slots').innerHTML = Array.from({ length: max }, (_, k) => `<span class="slot${k < running.length ? ' on' : ''}"></span>`).join('');
  $('#running').innerHTML = running.map((i) => `<div class="agent"><span class="g wait">running</span><div class="main"><span class="body-sm">${esc(i.agent_id)}</span>${ref(i, { actions: [] })}</div></div>`).join('');
  $('#finished').innerHTML = s.finishedToday.length
    ? s.finishedToday.slice().reverse().map((f) => `<div class="agent"><span class="g ${f.status === 'done' ? 'ok' : 'bad'}">${esc(f.status ?? 'done')}</span><div class="main"><span class="body-sm wrap">${esc(f.message.replace(/^\S+ \w+: /, ''))}</span>${f.item ? ref(s.items.find((i) => i.id === f.item.id) ?? f.item, { actions: [] }) : ''}${f.commits?.length ? `<span class="mono muted tiny">${esc(f.commits.map((c) => String(c).slice(0, 8)).join(' · '))}</span>` : ''}</div></div>`).join('')
    : '<div class="muted body-sm">Nothing yet.</div>';
}

const BAD = new Set(['failed', 'escalated', 'orphaned', 'pipeline-failed', 'conflicts']);
const GOOD = new Set(['merged', 'rebased', 'pipeline-green', 'review-done', 'question-answered']);
const ATTN = new Set(['question', 'review-requested', 'dashboard-request', 'dashboard-answer']);
const dotFor = (k) => (BAD.has(k) ? 'bad' : GOOD.has(k) ? 'ok' : ATTN.has(k) ? 'warn' : 'accent');

let firstLoad = true;
async function load() {
  let st;
  try {
    const r = await fetch('/api/state');
    if (!r.ok) throw new Error(r.statusText);
    st = await r.json();
  } catch {
    $('#offline').hidden = false;
    $('#live').classList.remove('on');
    setTimeout(load, 5000);
    return;
  }
  $('#offline').hidden = true;
  render(st);
  // Stagger the first paint; later updates (SSE) re-render in place without motion.
  if (firstLoad) {
    firstLoad = false;
    document.querySelectorAll('.tile, .panel, .lane').forEach((el, k) => { el.classList.add('enter'); el.style.animationDelay = `${Math.min(k, 10) * 30}ms`; });
  }
  const sum = await (await fetch('/api/summary?' + new URLSearchParams(range))).json();
  const evs = sum.events.filter((e) => e.kind !== 'created').reverse();
  const byId = new Map(last.items.map((i) => [i.id, i]));
  $('#events').innerHTML = evs.length
    ? evs.map((e) => {
        const item = e.item_id ? byId.get(e.item_id) : null;
        return `<div class="ev"><span class="time">${esc(hhmm(e.ts))}</span><span class="dot ${dotFor(e.kind)}"></span>
          <div class="main"><span class="msg">${esc(e.message)}</span>
          <span class="muted tiny">${esc(e.kind)}${item ? ' · ' : ''}${item ? ref(item, { actions: [] }) : e.item_id ? esc(e.item_id) : ''}</span></div></div>`;
      }).join('')
    : '<div class="muted">No activity in this range.</div>';
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 1800);
}

const post = async (path, payload) => {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload ?? {}) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
};

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-question]');
  if (!f) return;
  e.preventDefault();
  const typed = f.elements.text.value.trim();
  const text = typed || (f.dataset.approval === 'true' ? 'yes' : '');
  if (!text) { f.elements.text.focus(); return; }
  try { await post(`/api/questions/${f.dataset.question}/answer`, { text }); toast(`${f.dataset.question} answered. The loop acts on it shortly.`); load(); }
  catch (err) { toast(err.message); }
});

// Theme: system (default) / light / dark, remembered per browser. The <head> script applies it before paint.
function setTheme(choice, save = true) {
  if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  document.querySelectorAll('[data-theme-choice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === choice)));
  if (save) { try { choice === 'system' ? localStorage.removeItem('my-day-theme') : localStorage.setItem('my-day-theme', choice); } catch {} }
}
setTheme(document.documentElement.dataset.theme ?? 'system', false);

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.themeChoice) { setTheme(b.dataset.themeChoice); return; }
  try {
    if (b.dataset.copy) {
      await navigator.clipboard.writeText(b.dataset.copy);
      toast('Link copied');
    } else if (b.dataset.request) {
      await post(`/api/items/${b.dataset.item}/request`, { action: b.dataset.request });
      toast(`${ACTION_LABEL[b.dataset.request]} requested for ${b.dataset.item}. The loop picks it up shortly.`);
      load();
    } else if (b.dataset.decline) {
      await post(`/api/questions/${b.dataset.decline}/decline`);
      toast(`${b.dataset.decline} declined`);
      load();
    } else if (b.dataset.review) {
      await post(`/api/reviews/${b.dataset.review}/${b.dataset.act}`);
      load();
    } else if (b.dataset.range) {
      range = { [b.dataset.range]: '1' };
      document.querySelectorAll('.pill').forEach((p) => p.setAttribute('aria-pressed', String(p === b)));
      load();
    } else if (b.id === 'apply') {
      range = {};
      if ($('#from').value) range.from = $('#from').value;
      if ($('#to').value) range.to = $('#to').value;
      document.querySelectorAll('.pill').forEach((p) => p.setAttribute('aria-pressed', String(p === b)));
      load();
    } else if (b.id === 'pause') {
      await post(`/api/loop/${last?.loop.paused ? 'resume' : 'pause'}`);
      load();
    } else if (b.id === 'notify') {
      enableNotifications();
    }
  } catch (err) {
    toast(err.message);
  }
});

async function enableNotifications() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return;
  const { enabled, publicKey } = await (await fetch('/api/push/key')).json();
  $('#notify').textContent = 'Notifications on';
  if (!enabled || !('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (publicKey.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) });
}

async function hasPush() {
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(reg && (await reg.pushManager.getSubscription()));
}

function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => $('#live').classList.add('on');
  es.onerror = () => $('#live').classList.remove('on');
  es.addEventListener('change', () => load());
  // Push delivers notifications when subscribed; otherwise fall back to page notifications.
  es.addEventListener('notify', async (m) => {
    const n = JSON.parse(m.data);
    if (Notification.permission === 'granted' && !(await hasPush())) new Notification(n.title, { body: n.body, tag: n.tag });
  });
}

if ('Notification' in window && Notification.permission === 'granted') $('#notify').textContent = 'Notifications on';
load();
connect();
