import { useDashboard } from '../dashboard.jsx';
import { ACTION_LABEL, actionsFor, label, pendingRequests } from '../format.js';
import { CopyIcon, OpenIcon } from './Icons.jsx';

// A reference to an MR / ticket / link, always followed by its quick actions: copy, open, and
// the loop action. `actions` overrides the defaults (pass [] for none).
export function Ref({ item, text, url, actions }) {
  const { state, queue, undo, isQueued, toast } = useDashboard();
  const href = url ?? item?.url;
  const name = text ?? label(item);
  if (!href && !item) return null;
  // "pipeline" alone is ambiguous for screen readers when several MRs show one.
  const spoken = text && item ? `${text} of ${label(item)}` : name;
  const pending = pendingRequests(state);
  const acts = actions ?? actionsFor(item, state);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      toast('Link copied');
    } catch (err) {
      toast(err.message);
    }
  };

  return (
    <span className="ref">
      {href ? (
        <>
          <a href={href} target="_blank" rel="noopener">{name}</a>
          <button type="button" className="qa" onClick={copy} aria-label={`Copy link to ${spoken}`} title="Copy link"><CopyIcon /></button>
          <a className="qa" href={href} target="_blank" rel="noopener" aria-label={`Open ${spoken} in a new tab`} title="Open"><OpenIcon /></a>
        </>
      ) : (
        <span className="mono small">{name}</span>
      )}
      {acts.map((a) => {
        const sent = pending.has(`${item.id}:${a}`);
        const key = `request:${item.id}:${a}`;
        if (isQueued(key)) {
          return (
            <button key={a} type="button" className="act queued" onClick={() => undo(key)} title="Not sent yet. Click to take it back.">
              Undo {ACTION_LABEL[a].toLowerCase()}
            </button>
          );
        }
        return (
          <button
            key={a}
            type="button"
            className={`act${sent ? ' sent' : ''}`}
            disabled={sent}
            title={`Ask the loop to ${ACTION_LABEL[a].toLowerCase()} ${label(item)}`}
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
      })}
    </span>
  );
}
