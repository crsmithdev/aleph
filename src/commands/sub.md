---
description: Dispatch a subagent to handle a request
---

Dispatch a subagent for the request in: $ARGUMENTS

If `$ARGUMENTS` is empty, ask the user what they want the subagent to do.

Use the `Agent` tool with a self-contained prompt that includes:
- The full request from `$ARGUMENTS`
- Any relevant context from the current conversation needed to execute it

Use `subagent_type: "general-purpose"` unless the request clearly fits a more specialized agent (e.g. `code-debugger` for a debugging task, `code-review` for a review).

When the agent completes, report its result concisely.
