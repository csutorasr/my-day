const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TYPE_ORDER = ['mr', 'bug', 'story', 'subtask', 'review'];
const TYPE_LABEL = { mr: 'Merge requests', bug: 'Bugs', story: 'Stories', subtask: 'Subtasks', review: 'Reviews' };
const CLOSED = new Set(['done', 'merged', 'skipped', 'closed']);
let range = { today: '1' };

const links = (i) =>
  [i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">open</a>` : '']
    .concat((i.links ?? []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label ?? l.kind)}</a>`))
    .join('');

const row = (i, extra = '', right = `<span class="status">${esc(i.status)}</span>`) => `
  <li><span class="id">${esc(i.id)}</span>
    <div><div class="title">${esc(i.title ?? i.ext_key)}</div>${extra}<div class="links">${links(i)}</div></div>
    ${right}</li>`;

function render(s) {
  $('#dry').hidden = !s.dryRun;
  $('#dir').textContent = s.dir;
  $('#c-reviews').textContent = s.reviews.length || '';
  $('#reviews').innerHTML = s.reviews.length
    ? s.reviews.map((r) => row(r, '', `<span><button data-review="${esc(r.id)}" data-act="done">Done</button> <button data-review="${esc(r.id)}" data-act="skip">Skip</button></span>`)).join('')
    : '<li class="empty">Nothing to review.</li>';
  $('#c-questions').textContent = s.questions.length || '';
  $('#questions').innerHTML = s.questions.length
    ? s.questions.map((q) => `<li><span class="id">${esc(q.id)}</span><div><div class="title">${esc(q.text)}</div><div class="sub">${q.item_id ? esc(q.item_id) + ' · ' : ''}answer in the session</div></div><span></span></li>`).join('')
    : '<li class="empty">No open questions.</li>';
  $('#c-failed').textContent = s.failed.length || '';
  $('#failed').innerHTML = s.failed.length
    ? s.failed.map((f) => row(f, `<div class="reason">${esc(f.fail_reason)}</div>${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}`)).join('')
    : '<li class="empty">Nothing failed.</li>';

  const open = s.items.filter((i) => !CLOSED.has(i.status) && i.type !== 'review');
  const closed = s.items.filter((i) => CLOSED.has(i.status) && i.type !== 'review');
  $('#c-tasks').textContent = open.length || '';
  const group = (list) =>
    TYPE_ORDER.map((t) => {
      const its = list.filter((i) => i.type === t);
      if (!its.length) return '';
      return `<h2>${TYPE_LABEL[t]} <span class="count">${its.length}</span></h2><ul class="rows">${its
        .map((i) => row(i, `<div class="sub">${[i.branch, i.repos?.join(', '), i.agent_id ? 'agent running' : '', i.attempts ? `attempts ${i.attempts}` : ''].filter(Boolean).map(esc).join(' · ')}</div>`))
        .join('')}</ul>`;
    }).join('');
  $('#board').innerHTML = (group(open) || '<div class="empty">No open tasks.</div>') +
    (closed.length ? `<details><summary>Closed (${closed.length})</summary>${group(closed)}</details>` : '');
}

async function load() {
  render(await (await fetch('/api/state')).json());
  const sum = await (await fetch('/api/summary?' + new URLSearchParams(range))).json();
  const evs = sum.events.filter((e) => e.kind !== 'created').reverse();
  $('#events').innerHTML = evs.length
    ? evs.map((e) => `<div class="ev"><span class="k">${esc(new Date(e.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span><span class="k">${esc(e.kind)}</span><span>${esc(e.message)}</span></div>`).join('')
    : '<div class="empty">No activity in this range.</div>';
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.review) {
    await fetch(`/api/reviews/${b.dataset.review}/${b.dataset.act}`, { method: 'POST' });
    load();
  } else if (b.dataset.range) {
    range = { [b.dataset.range]: '1' };
    load();
  } else if (b.id === 'apply') {
    range = {};
    if ($('#from').value) range.from = $('#from').value;
    if ($('#to').value) range.to = $('#to').value;
    load();
  } else if (b.id === 'notify') {
    enableNotifications();
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
  es.onopen = () => $('#live').classList.add('live');
  es.onerror = () => $('#live').classList.remove('live');
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
