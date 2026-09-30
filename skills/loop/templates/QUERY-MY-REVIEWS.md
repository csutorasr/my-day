<!-- TEMPLATE — a worked example (Jira + GitLab). my-day:setup replaces every <PLACEHOLDER> and rewrites tool-specific parts for the user's tracker and code host. -->
# Query: reviews requested from me

Handled by `$SM tick` (sync): open, non-draft MRs where my review is requested become
`review` items. A new request that I already approved is closed silently; the rest raise a
`review-requested` event (more than `reviewBatchNotify` at once → one `notify`). A review
counts as done when I approve or comment after the request; `skipped` re-opens when the MR
changes. With `hideCoveredReviews: true` a request that someone else already approved or
requested changes on becomes `covered` (event `review-covered`, no notification): hidden from
the dashboard and `reviewsPending`, but still re-checked whenever the MR changes. It returns to
`new` (`review-requested`) when my review is re-requested and an approval is still needed.
The dashboard notifies — never open the MR in the browser.
