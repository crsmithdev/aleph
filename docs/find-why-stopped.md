# Find why an issue stopped

This page shows you how to find why an issue or a run stopped, and how to move it again. Find the cause first, then act.

## 1. Find the cause

Read the record that answers your question.

| To learn | Read |
|---|---|
| Why an issue did not start | The issue's `held` events in `aleph.db`, or the Holds panel on Status |
| Why a run stopped | `aleph status <repo>-<n>`, or the job page |
| What a check printed | the `checks` section of `~/.aleph/jobs/<n>/log.txt` |
| What the director decided | The Automation page |
| What the sweep caught | the event log, events with the action `missed` |

## 2. Act on the cause

Take the action that fits the cause. Each action has a command, and a control in the UI.

| To | CLI | UI |
|---|---|---|
| Stop and restart new work | `aleph pause`, `aleph resume` | Pause button |
| Land a passed run, or one that waits on a `held-path` or `review-held` Ask | `aleph land <name>` | Land it |
| Drop a run and its branch | `aleph drop <name> [reason]` | Drop the job |
| Check a returned or failed run again, keeping its work | `aleph recheck <name>` | Recheck |
| Answer an issue that waits | `aleph issue decide <repo> <id> "<text>"` or `note` | Decide, Note |
| Change an issue's spec | `aleph issue edit <repo> <id> --spec -` | Edit |
| Grant or revoke a standing rule | `aleph always grant\|revoke` | Always, Automation page |
| Set a no-answer timeout | `aleph always timeout <reason> <minutes> [pick\|drop]` | Automation page |
| Set caps and models | `aleph models`, the `caps` setting | Automation page, Agents page |

A write to an issue starts intake or a dispatch at once. A land by hand writes `Held-by:` with the lander's name.

## Next steps

- [Stages of an issue](workflow.md#stages-of-an-issue) says what each stage in `aleph status` means.
- [Rescue](workflow.md#7-rescue) lists what the factory does with a stopped run before it asks you.
- [Asks](workflow.md#8-asks-the-director-and-always-rules) lists each reason an issue waits, and the actions that answer it.
- [Commands](factory.md#commands) has `aleph investigate`, which traces what happened to an issue or a job.
