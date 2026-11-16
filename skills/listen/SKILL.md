---
name: listen
description: Wait for notes Chris sends to the shelf inbox and act on each. Use when Chris asks this session to listen.
---

# Listen

The shelf (`~/aleph-tools/shelf.ts`, served by the aleph UI at `/shelf/`) keeps notes that Chris sends with the
Terminal button. A send from a shelf item goes to the agent that waits on that item. A send from any other page goes
to the inbox. This skill makes this session the inbox's listener.

1. Run `bun ~/aleph-tools/shelf.ts wait` with `run_in_background`, then end the turn.
2. When `wait` exits 0, its output is Chris's notes as Markdown: the page, each note, and the element it is pinned on.
   Act on them as a request from Chris.
3. Run `wait` again, as in step 1. Do this after each send until Chris says to stop. Then stop the background task.

If `wait` exits 3, another session took the inbox: say so and stop. If it exits 2, no shelf answers: say that the
aleph UI is not running, and stop.

`wait` acknowledges a send only after it prints it. A `wait` that dies before that leaves the send for the next one.
