# Sweep

Go through every handoff of this repo, find the items nobody handled, explain them, and ask Chris about the ones
that need him. A pickup archives a handoff when a session reads it, not when its items are done. So judge each
item from the current state, never from the handoff text alone.

## Find the items

1. Set `<handoffs dir>` to `$ALEPH_HANDOFFS_DIR` if set, else `~/.aleph/handoffs`. Get `<scope>` from
   `d=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && basename "$(dirname "$d")" || basename "$PWD"`.
2. Read the waiting `<handoffs dir>/projects/<scope>.md`, if it exists, and every `<YYYY-MM-DD-HHMMSS>-<scope>.md`
   in `<handoffs dir>`, newest first. The ledger is `<handoffs dir>/handled.jsonl`.
3. List the items. An item is one bullet of **Open questions**, one step of **Active plan** that the handoff does
   not mark done, or the next action of **Resume instructions**. Skip an item when the ledger has a line with the
   same `file` and `item`.

## Judge each item

Judge each item from the state now. Use `git log` since the handoff's time, `aleph issue show` and `aleph issue
list`, the newer handoffs, `git worktree list`, and the files the item names. Give each item one verdict:

| Verdict | When |
|---|---|
| `done` | A commit, a closed issue or a file shows it is done. Name that evidence. |
| `superseded` | A newer handoff, a decision or a commit replaces it. Name what replaces it. |
| `open-work` | It needs no decision, but the work is not done. |
| `open-decision` | Chris must choose. |

If more than 5 handoffs have items, give them to Explore agents, about 5 handoffs each, all in one message. Give
each agent the paths, the item rules and the verdict table, and ask for each item's text, verdict and evidence.
Otherwise judge them yourself.

Append each `done` and `superseded` item to the ledger at once, one JSON line each:
`{"at": "<ISO time>", "file": "<handoff file name>", "item": "<item text>", "verdict": "<verdict>", "note": "<evidence>"}`.

## Explain, then ask

1. Write one message. Number every open item, newest handoff first. For each item, give the handoff date, what the
   item is, why it is still open with its evidence, and your recommendation. End with one line that counts the
   `done` and `superseded` items. Do not list those items.
2. If no item is open, say so in one line and stop.
3. Ask in the question UI, up to 4 items per call, with the recommended option first. An `open-decision` item gets
   its real options. An `open-work` item gets "Do it" and "Drop it".
4. Act on each answer as the session's work mode says (`/aleph:mode`, factory if none is set). Append it to the
   ledger with the verdict `decided` or `dropped` and the answer in `note`.
5. If every item of the waiting `projects/<scope>.md` is now in the ledger, archive it the way a pickup does: move it
   to `<handoffs dir>/$(date +%Y-%m-%d-%H%M%S)-<scope>.md`.
