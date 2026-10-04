<!-- TEMPLATE — a worked example (Jira). my-day:setup replaces every <PLACEHOLDER>. -->
# Feedback intake

## Group
- Same underlying need = same cluster, whatever the wording. One cluster is one `feedback`
  item: `--ext fb:<slug>`, title "<need> (<n> requests)", a link per source message
  (`$SM link <id> --kind other --url …`), `data.requests` = count, `data.customers` = names.
- A new request joins an existing cluster when the need matches; otherwise a new cluster with
  status `new`.

## Route a cluster
1. An open ticket already covers it → status `linked`, `data.ticket` = key. Each time
   `data.requests` grows by `<COMMENT_EVERY>`, draft a comment on the ticket with the new quotes
   and customers (`jira: comment`, `WRITES.md`).
2. No ticket, `data.requests` ≥ `<NEW_TICKET_THRESHOLD>` → draft a ticket: problem in the
   customers' words, who asked, rough impact; no solution (`jira: create issue`, `WRITES.md`).
   Created → status `linked`.
3. Below the threshold → status `watching`.
4. Clearly a bug → draft a Bug instead, with the reproduction the customer gave.

## Reply to the requester
Only when `<REPLY_TO_REQUESTERS>` is yes: a short thanks with the ticket link, as a draft
(`slack: reply thread`, `WRITES.md`). Never promise a date.

## Never
- Share one customer's name or message with another customer.
- Put customer names in public channels.
