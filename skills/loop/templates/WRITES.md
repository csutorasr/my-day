<!-- TEMPLATE — shared by every profile. my-day:setup fills the rows from the profile's `## Writes defaults` (SETUP.md) and the user's answers. Personal tightening goes into WRITES.local.md (its rows win). -->
# Outward writes

Everything the loop does outside this workspace — a merge, a ticket comment, a Slack post, an
email — is an **action** `<source>: <verb>` with a policy. Before any outward action the loop
finds its row (else `default`):

- **auto** — do it.
- **ask** — draft it and wait for approval:
  `$SM ask <id|-> "<one line: what and why>" --draft -` with `{"action","target","body"}` on
  stdin. On approval (`tick` → `approvedDrafts`, or `fromDashboard`) write exactly the approved
  body (it may have been edited), then `$SM wrote <q-n> [--url <where it landed>]`. Declined →
  don't write; the answer says why.
- **never** — don't do it: `$SM event <id> write-blocked "<action> → <target>"`; do the
  fallback in *note* instead when there is one.

`dryRun: true` wins over every row: writes become `dry-run` events. Workers never perform an
`ask` or `never` write; they return it in `drafts` and the loop asks.

| action | policy | note |
|---|---|---|
| <SOURCE>: <VERB> | auto | |
| default | ask | |
