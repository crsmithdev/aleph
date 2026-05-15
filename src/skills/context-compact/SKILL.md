---
name: context-compact
description: Guide context compaction at logical task phase boundaries rather than letting auto-compaction hit mid-task. Use when approaching context limits, switching between phases, or after completing a major milestone. Triggers on "compact context", "switch phase", "/context-compact".
---

# Strategic Compact

## When to Use

- Session is approaching context limits (80%+ — context-monitor-stop will warn)
- Completing a major phase (research done, plan finalized, debugging resolved)
- Switching to an unrelated task within the same session
- After a failed approach: compact before trying a new strategy
- When responses feel less coherent — often a sign of context pressure

## Phase Boundary Decision Table

| Transition | Compact? | Reason |
|---|---|---|
| Research → Planning | Yes | Research context is bulky; the plan is the distilled output |
| Planning → Implementation | Yes | Plan is in TodoWrite or a file; free up context for code |
| Implementation → Testing | Maybe | Keep if tests reference recent code; compact if switching focus |
| Debugging → Next feature | Yes | Debug traces pollute context for unrelated work |
| Mid-implementation | No | Losing variable names, file paths, and partial state is costly |
| After a failed approach | Yes | Clear dead-end reasoning before trying a new strategy |

## What Survives Compaction

| Persists | Lost |
|---|---|
| CLAUDE.md instructions | Intermediate reasoning and analysis |
| TodoWrite task list | File contents read earlier in session |
| Memory files (~/.claude/memory/) | Multi-step conversation context |
| Git state (commits, branches, files) | Tool call history |
| Files on disk | Nuanced user preferences stated verbally |

## How to Compact Safely

1. **Before compacting:** Save key context to files or memory
   - Write the current plan/state to a file
   - Run `memory_store` for any decisions or patterns worth preserving
2. **Compact with a summary:** `/compact Focus on implementing X next`
3. **After compacting:** Verify CLAUDE.md and TodoWrite are intact

## Integration

The `context-suggest-edit` hook fires on Edit/Write and counts tool calls.
At 50 calls it suggests compaction; reminds every 25 after. The suggestion
includes this decision table inline. The `context-monitor-stop` hook warns
at 80% and 90% context usage.

## Done when

- Session context is below 70%
- Next phase has a clean starting context
- Key state is persisted to files or memory
