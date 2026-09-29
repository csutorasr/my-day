<!-- TEMPLATE — a worked example (Jira + GitLab). my-day:setup replaces every <PLACEHOLDER> and rewrites tool-specific parts for the user's tracker and code host. -->
# Query: reviews requested from me

Handled by `$SM tick` (sync): open, non-draft MRs where my review is requested become
`review` items. A new request that I already approved is closed silently; the rest raise a
`review-requested` event (more than `reviewBatchNotify` at once → one `notify`). A review
counts as done when I approve or comment after the request; `skipped` re-opens when the MR
changes. The dashboard notifies — never open the MR in the browser.
