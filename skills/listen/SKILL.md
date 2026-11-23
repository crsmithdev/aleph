---
name: listen
description: Wait for notes the user sends to the shelf inbox and act on each. Use when the user asks this session to listen.
---

# Listen

The shelf (`shelf`) keeps notes that the user sends with the
Send button. A send from a shelf item goes to the agent that waits on that item. A send from any other page goes
to the inbox. This skill makes this session the inbox's listener.

1. Run `shelf wait` with `run_in_background`, then end the turn.
2. When `wait` exits 0, its output is `send: <n>`, then the user's notes as Markdown: the page, each note, and the
   element it is pinned on. Act on them as a request from the user. When the second line is `answer: <kind>`, the send
   is an answer: follow [ANSWERS.md](ANSWERS.md).
3. Run `wait` again, as in step 1. Do this after each send until the user says to stop. Then stop the background task.

If `wait` exits 3, another session took the inbox: say so and stop. If it exits 2, the inbox is missing, which is
unexpected: say so and stop.

`wait` acknowledges a send only after it prints it. A `wait` that dies before that leaves the send for the next one.
