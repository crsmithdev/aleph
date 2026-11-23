---
name: sweep
description: >
  Find unhandled follow-ups of this session, or with `all` of every recent session and handoff of this repo. Use
  when asked to sweep.
argument-hint: "[all] [--since <ISO time>]"
---

# Sweep

Find the items this session leaves open, explain them, and ask the user about the ones that need them. With `all`,
do the same for this repo's handoffs and every session since the last sweep. A pickup archives a handoff when a
session reads it, not when its items are done, and a session can end with a follow-up nobody filed. So judge each
item from the current state, never from the handoff or transcript text alone.

## Find the items

1. Set `<handoffs dir>` to `$ALEPH_HANDOFFS_DIR` if set, else `~/.aleph/handoffs`. Get `<scope>` from
   `d=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && basename "$(dirname "$d")" || basename "$PWD"`.
   The ledger is `<handoffs dir>/handled.jsonl`.
2. **Transcripts.** Run one of these from the main checkout:
   - Without `all`, read this session from its start, so a compaction loses no item:

     ```bash
     bun <this skill's dir>/turns.ts --session "$CLAUDE_CODE_SESSION_ID" --repo "$(dirname "$d")" > <scratchpad>/turns.md
     ```

   - With `all`, set `<since>` to the `--since` value in `$ARGUMENTS`, else the `at` of the newest ledger line with
     `"verdict": "swept"`, else 7 days ago:

     ```bash
     bun <this skill's dir>/turns.ts --since <since> --repo "$(dirname "$d")" > <scratchpad>/turns.md
     ```

   It prints one `## <session id> <start> to <end>` block per session that the user drove, with what they typed or
   answered (`Chris:`), each question put to them (`Asks:`) and the reply that ended each turn (`Reply:`). A long
   reply keeps its start and its end. A transcript item is one of these:
   - A question put to the user that they did not answer in that session or a later one.
   - A decision left open: options offered and none chosen, or a choice the session put off.
   - A follow-up, risk, `Left out:` or `Not verified:` line that a reply names and no issue, commit or later
     session holds.
   - A request from the user that the session did not finish: it ended mid-work, or its branch or worktree did not
     land.
   - A loose end the session leaves: uncommitted changes, a worktree not removed, a server or background job still
     running, an issue named but not filed.
   - The next action at the end of a session that no later session took.
3. **Handoffs**, only with `all`. Read the waiting `<handoffs dir>/projects/<scope>.md` and every
   `<handoffs dir>/projects/<scope>/<pane>.md`, if they exist, and every `<YYYY-MM-DD-HHMMSS>-<scope>.md` in
   `<handoffs dir>`, newest first. A handoff item is one bullet of **Open questions**, one step of **Active plan**
   that the handoff does not mark done, or the next action of **Resume instructions**. Skip a transcript item that
   a handoff item already covers.
4. Skip an item when the ledger has a line with the same `file` and the same item. For a transcript item, `file` is
   `<session id>.jsonl`, and the same item is the same follow-up in other words.

## Judge each item

Judge each item from the state now. Use `git log` since the item's time, `git worktree list`, `git branch`,
`aleph issue list <scope>` and `aleph issue show <scope> <n>`, the newer handoffs and sessions, and the files the
item names. Give each item one verdict:

| Verdict | When |
|---|---|
| `done` | A commit, an issue or a file shows it is done or filed. Name that evidence. |
| `superseded` | A newer handoff, session, decision or commit replaces it. Name what replaces it. |
| `open-work` | It needs no decision, but the work is not done and no issue holds it. |
| `open-decision` | The user must choose. |

If more than 5 handoffs have items, or `turns.md` is over 100 KB, split the work and give it to Explore agents,
all in one message: about 5 handoffs, or about 100 KB of `turns.md` cut at `## ` lines, each. Give each agent the
paths, the item rules and the verdict table, and ask for each item's text, source file, time, verdict and evidence.
Otherwise judge them yourself.

Append each `done` and `superseded` item to the ledger at once, one JSON line each:
`{"at": "<ISO time>", "file": "<handoff file name or session id>.jsonl", "item": "<item text>", "verdict": "<verdict>", "note": "<evidence>"}`.
For a handoff, `file` is the handoff file name.

## Explain, then ask

1. Write one message. Number every open item, newest first. For each item, give its date and source (handoff or
   session id), what the item is, why it is still open with its evidence, and your recommendation. End with one
   line that counts the `done` and `superseded` items. Do not list those items.
2. If no item is open, say so in one line, and go to step 5.
3. Ask in the question UI, up to 4 items per call, with the recommended option first. An `open-decision` item gets
   its real options. An `open-work` item gets "Do it", "File it" and "Drop it". In a headless run (`claude -p`)
   there is no question UI: skip steps 3 and 4, leave the open items out of the ledger, and go to step 5.
4. Act on each answer as the session's work mode says (`/aleph:mode`, solo if none is set). Append it to the
   ledger with the verdict `decided` or `dropped` and the answer in `note`.
5. With `all`, append one line that marks the transcripts as swept up to the time `turns.ts` ran:
   `{"at": "<that ISO time>", "file": "transcripts", "item": "sweep", "verdict": "swept", "note": "<n> sessions"}`.
6. With `all`, if every item of a waiting `projects/<scope>.md` or `projects/<scope>/<pane>.md` is now in the ledger, archive it the way a pickup does: move it
   to `<handoffs dir>/$(date +%Y-%m-%d-%H%M%S)-<scope>.md`.
