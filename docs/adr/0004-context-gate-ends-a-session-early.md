# 4. The context gate ends a session before its context does

- Status: accepted
- Date: 2026-09-26

## Context

The decision came from a measurement of 14 days: the 57 main-thread transcripts over 2 MB, plus the subagent transcripts.

| Measure | Value |
|---|---|
| Main-thread requests | 36,466 |
| Main-thread cache-read tokens | 8.52 B, 300–490k replayed per request |
| Subagent requests / cache-read | 3,013 / 274 M, 3% of the spend |
| `Agent` results in the parent | 100 calls, 26k tokens, 0.3% of tool tokens |
| Peak fill of a session | 570k–908k against a 967k threshold |
| Compactions in 1,645 transcripts | 0 |
| Main-thread tool tokens | 9.2 M: Bash 76% over 11,475 calls, median 107, p99 3,862 |
| One 908k session | tool results 70%, tool_use inputs 16%, attachments 6% |
| First-request fill | median 31k, max 48k |

Subagents are not the leak: a report costs 0.3k, and the work happens in a window that no later request replays. The leak is the main thread. On a 1M window the compaction threshold (967k) never arrives, so a session stays at 700k and every request reads the whole context again.

## Decision

A smaller window, a warning and one block end a session before its context does. [Hooks](../hooks.md#context-gate) says what the gate does. This table gives the reason for each decision.

| # | Decision | Reason |
|---|---|---|
| 1 | The window is 400k, set as `autoCompactWindow` in `~/.claude/settings.json`. The threshold is then 367k and the warning starts at 275k. | 200k was below where sessions do their work. Measured over the 99 sessions that ran under it: 3 compacted, and 5 ran past 200k coherent, one to 314k. 400k keeps about 92k of room after the warning and holds cache reads near 168k a request, against 469k at a 1M window. |
| 2 | `bashOutputMaxChars` is 15000. The default is 30000, and the setting accepts 4000 to 128000. | The cap binds at the tail: the largest Bash result measured was 7,425 tokens, exactly the 30000-character cap, and the top 10% of calls carry 57% of Bash tokens. A result over the cap comes back as a 2 KB preview and a file path, so the cap loses no output. The first value, 8000, went to 15000 in a later round of context settings (vault note What Fills Interactive Context). |
| 3 | The fill comes from the last assistant request in the transcript. The window comes from `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, then the `autoCompactWindow` setting, then 1M. The threshold is the window minus 33k. | Claude Code reads the window from the same places. 33k is `min(maxOutput, 20k) + 13k`, measured in Claude Code 2.1.283. |
| 4 | Above 0.75 of the threshold the gate warns the user and the turn passes. The warning names the budget, not a prediction. | The decision to end a session is the user's, and a warning at 275k leaves about 92k to finish the thought. The setting does not reliably force compaction, so the warning claims only what the gate knows. |
| 5 | Once the session has compacted, the gate blocks the `Stop` and asks for a handoff and a `/clear`: once per session, never on a retry. A `microcompact_boundary` is not a compaction. | After a compaction the context is a summary, and a handoff written from a later summary is worse than one written at once. A second block is a stuck turn. Microcompaction only evicts old tool results, so the conversation survives. It also fires early in a session with many tool calls and lowers the fill. |
| 6 | The gate runs on the main agent's `Stop` in an interactive session only. It posts no span and no score. | Subagents report to the main agent. A headless session has no the user to read a warning or a handoff. `obs.ts` already records the `Stop` event, and the verdict is in the transcript. |

## Consequences

- The two settings of decisions 1 and 2 are in `~/.claude/settings.json`, outside the repo. No code in the repo sets them, so the file can differ from this record.
- Read-heavy and search-heavy sweeps go to subagents. Measured: 3% of the tokens, and 0.3k back into the parent.
- `/aleph:handoff` and then `/clear` is the session boundary. The gate only decides when.
