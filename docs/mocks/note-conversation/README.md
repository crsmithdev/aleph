# A conversation on a note

Request (Chris, 2026-11-23): talk with the agent about one note, inline, in place of one answer button.

## Decisions in every variant

- **One thread per note.** The finding is the first message. Each message after it is named: You or Agent. The
  thread is saved as the note's replies, so a terminal session that takes the note reads the whole talk.
- **The chat agent answers.** A question goes to the page's chat tool (aleph-tools `chat.js`, `claude -p` on the
  server), pointed at the note through its `annotations` ids. It answers in seconds, with no terminal session open.
  The answer streams into the thread.
- **A talk can end in a proposal.** An agent message that starts with `proposal:` shows Approve and Discard, as the
  dock does now for a proposal reply.
- **The answer buttons stay.** Change UI, Change language and Exception send the note and its thread to the
  terminal session, as now.
- **Agent colour.** The agent's name and the edge use `--agent`, and your messages use `--accent`, as the pins do.

## Variants

| Variant | Where the talk is | Good for |
|---|---|---|
| A. Thread in the editor | the note editor grows | one note at a time, near its element |
| B. Side panel | a panel at the side, with Prev and Next | going through many findings in a row |
| C. Bubble on the element | hangs from the pin | short talks; small |

## What changes in code

- `annotate.js`: the thread, the Ask field, and a call to the chat tool's `send(text, ids)`.
- `chat.js`: one chat session per note, keyed by the note id, and each turn written back as replies.
- The unread dot on a pin.
