import { useDashboard, useIsPhone } from '../dashboard.jsx';
import { ACTION_HINT, ACTION_LABEL, RISKY_ACTIONS, actionsFor, label, pendingRequests } from '../format.js';
import { CopyIcon, OpenIcon } from './Icons.jsx';

// Quick actions the loop can take on an item, through the outbox (undoable for a few seconds).
// Merge and rebase are left out on phones: they change shared history.
export function Actions({ item, actions }) {
  const { state, queue, undo, isQueued } = useDashboard();
  const phone = useIsPhone();
  if (!item) return null;
  const pending = pendingRequests(state);
  const acts = (actions ?? actionsFor(item, state)).filter((a) => !(phone && RISKY_ACTIONS.has(a)));
  return acts.map((a) => {
    const key = `request:${item.id}:${a}`;
    if (isQueued(key)) {
      return (
        <button key={a} type="button" className="act queued" onClick={() => undo(key)} title="Not sent yet. Click to take it back.">
          Undo {ACTION_LABEL[a].toLowerCase()}
        </button>
      );
    }
    const sent = pending.has(`${item.id}:${a}`);
    return (
      <button
        key={a}
        type="button"
        className={`act${sent ? ' sent' : ''}`}
        disabled={sent}
        title={`Ask the loop to ${ACTION_HINT[a]}`}
        aria-label={`${ACTION_LABEL[a]} ${label(item)}: ask the loop to ${ACTION_HINT[a]}`}
        onClick={() => queue({
          key,
          label: `${ACTION_LABEL[a]} ${label(item)}`,
          path: `/api/items/${item.id}/request`,
          payload: { action: a },
          ok: `${ACTION_LABEL[a]} requested for ${label(item)}. The loop picks it up within seconds.`,
        })}
      >
        {sent ? `${ACTION_LABEL[a]} requested` : ACTION_LABEL[a]}
      </button>
    );
  });
}

// A reference to an MR / ticket / link: the link itself (one Tab stop; press `c` on it to copy),
// mouse-only copy and open icons, then its quick actions. `actions={[]}` shows none.
export function Ref({ item, text, url, actions }) {
  const { toast } = useDashboard();
  const href = url ?? item?.url;
  const name = text ?? label(item);
  if (!href && !item) return null;
  // "pipeline" alone is ambiguous for screen readers when several MRs show one.
  const spoken = text && item ? `${text} of ${label(item)}` : name;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      toast('Link copied');
    } catch (err) {
      toast(`Could not copy the link: ${err.message}`, { error: true });
    }
  };

  return (
    <span className="ref">
      {href ? (
        <>
          <a href={href} target="_blank" rel="noopener" data-copy={href} aria-label={`${spoken} (opens in a new tab, press c to copy the link)`}>{name}</a>
          <button type="button" className="qa" tabIndex={-1} onClick={copy} aria-label={`Copy link to ${spoken}`} title="Copy link"><CopyIcon /></button>
          <a className="qa" href={href} target="_blank" rel="noopener" tabIndex={-1} aria-hidden="true" title="Open in a new tab"><OpenIcon /></a>
        </>
      ) : (
        <span className="mono small">{name}</span>
      )}
      {item && <Actions item={item} actions={actions} />}
    </span>
  );
}
