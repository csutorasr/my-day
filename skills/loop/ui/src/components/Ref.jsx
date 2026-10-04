import { useDashboard } from '../dashboard.jsx';
import { ACTION_LABEL, actionsFor, label, pendingRequests } from '../format.js';
import { CopyIcon, OpenIcon } from './Icons.jsx';

// A reference to an MR / ticket / link, always followed by its quick actions: copy, open, and
// the loop action. `actions` overrides the defaults (pass [] for none).
export function Ref({ item, text, url, actions }) {
  const { state, act, toast } = useDashboard();
  const href = url ?? item?.url;
  const name = text ?? label(item);
  if (!href && !item) return null;
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
          <button type="button" className="qa" onClick={copy} aria-label={`Copy link to ${name}`} title="Copy link"><CopyIcon /></button>
          <a className="qa" href={href} target="_blank" rel="noopener" aria-label={`Open ${name} in a new tab`} title="Open"><OpenIcon /></a>
        </>
      ) : (
        <span className="mono small">{name}</span>
      )}
      {acts.map((a) => {
        const sent = pending.has(`${item.id}:${a}`);
        return (
          <button
            key={a}
            type="button"
            className={`act${sent ? ' sent' : ''}`}
            disabled={sent}
            title={`Ask the loop to ${ACTION_LABEL[a].toLowerCase()} on its next tick`}
            onClick={() => act(`/api/items/${item.id}/request`, { action: a }, `${ACTION_LABEL[a]} requested for ${item.id}. The loop picks it up shortly.`)}
          >
            {sent ? `${ACTION_LABEL[a]} requested` : ACTION_LABEL[a]}
          </button>
        );
      })}
    </span>
  );
}
