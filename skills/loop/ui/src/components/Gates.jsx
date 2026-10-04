import { gates } from '../format.js';

// Merge-gate chips of an MR (pipeline, approvals, threads, conflicts, target).
export function Gates({ mr, target }) {
  return (
    <div className="gates">
      {gates(mr, target).map(([text, tone]) => <span key={text} className={`g ${tone}`}>{text}</span>)}
    </div>
  );
}
