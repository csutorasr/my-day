<!-- TEMPLATE — a worked example (Slack + Gmail). my-day:setup replaces every <PLACEHOLDER> and rewrites the sources. -->
# Query: questions for me

Stakeholder questions that wait for my reply. One `thread` item per conversation. "Since the
last refresh" = the source's cursor item (`cursor:mentions-<source>`, as in `QUERY-FEEDBACK.md`).

## Slack
Source: `mcp:slack`. Messages that mention me or are DMs to me since the last refresh, in
`<STAKEHOLDER_CHANNELS>` and DMs, where the last message is not mine and asks something
(a question mark, "can you", "when will", "do we").
Upsert `--type thread --ext slack:<channel>/<thread_ts> --title "<who>: <first line>" --url <permalink>`,
status `new`. My reply posted (by me or the loop) → status `done`.

## Email
Source: `mcp:gmail`. Unread threads from `<STAKEHOLDER_LIST>` (people or domains) in the inbox
since the last refresh. Upsert `--type thread --ext gmail:<threadId>`, status `new`. Delete this
section when email is not used.

## Not mine
Announcements, FYIs, threads where someone else already answered, and anything from
`<IGNORED_SENDERS>` → skip.
