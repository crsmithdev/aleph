# Agent notes in the dock

Request (Chris, 2026-11-23): the notes that refit-design adds read as raw keys, and the note editor shows them as if
Chris wrote them. Show a readable finding, and show that the agent wrote it.

## Decisions in every variant

- **A sentence first.** The note opens with a title of the change and one plain sentence. The key, the rule and the
  places go last, as `rule:`, `where:` and `finding:` lines. Rule `be-terse`: the reader sees what matters first.
- **Read-only text.** The editor shows an agent note as text, not in Chris's note box. Chris answers in the Reply
  box. No design rule covers this: the note box holds Chris's own words.
- **No quick actions.** Delete, Move, Refit and Explain are for Chris's own notes, so an agent note hides them.
- **Dismiss, not Delete.** Delete of an agent note becomes Dismiss: refit-design adds no second note while an
  unresolved note holds the key, so a dismissed note is resolved, not dropped.
- **Agent colour.** An agent pin and list number take one colour of their own (`--agent`, blue). Today the pin is
  `--ink`, which reads as a dark dot. Rule `colour-token`: the dock needs a new token for it.

## Variants

| Variant | Marks the author with | Rule and place |
|---|---|---|
| A. Byline | a `refit-design` tag in a byline | in a closed fold |
| B. Marked card | a blue left edge and a byline | open, muted |
| C. Thread | the first message of a thread, named | in the message |

## What changes in code

- refit-design writes the new note form: `scripts/notes.ts` reads a `summary` field of each finding and keeps the
  key line last. The key check reads any `finding:` line.
- `annotate.js` (aleph-tools): an editor branch for `by: "agent"`, the `--agent` token, and Dismiss.
