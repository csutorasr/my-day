<!-- TEMPLATE — a worked example (Slack + Intercom). my-day:setup replaces every <PLACEHOLDER> and rewrites the sources to what the user collects feedback from. -->
# Query: feedback

Where product feedback arrives. Each source is read since its own cursor, the last 7 days the
first time. A cursor is a marker item that never shows on a board:
`$SM upsert --type cursor --ext cursor:feedback-<source> --status ignored --data '{"cursor":"<iso or id>"}'`
(read it back with `$SM get cursor:feedback-<source>`); move it after each successful read.
New messages are grouped by `FEEDBACK.md`.

## Slack channels
Source: `mcp:slack`. Read `<FEEDBACK_CHANNELS>` (e.g. `#feedback`, `#sales-requests`) since the
cursor; skip bot messages and thread replies that only say "+1" (count them instead).

## Support conversations
Source: `mcp:intercom`. Conversations tagged `<FEEDBACK_TAG>` since the cursor; take the
customer's request in their words and the company / plan.

## Forms / other
`<OTHER_SOURCES>` (a Google Form sheet, a feedback board …) or delete this section.

Each request becomes input to `FEEDBACK.md`; nothing is upserted until it is grouped.
