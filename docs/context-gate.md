# Context gate

Decided 2026-09-26 from measurement. A Stop hook that ends a session before its
context does.

## What the numbers said

14 days, the 57 main-thread transcripts over 2 MB, plus the subagent ones:

| measure | value |
|---|---|
| main-thread requests | 36,466 |
| main-thread cache-read tokens | 8.52 B, 300–490k replayed per request |
| subagent requests / cache-read | 3,013 / 274 M, 3% of the spend |
| `Agent` results in the parent | 100 calls, 26k tokens, 0.3% of tool tokens |
| peak fill a session | 570k–908k against a 967k threshold |
| compactions in 1,645 transcripts | 0 |
| main-thread tool tokens | 9.2 M: Bash 76% over 11,475 calls, median 107, p99 3,862 |
| one 908k session | tool results 70%, tool_use inputs 16%, attachments 6% |
| first-request fill | median 31k, max 48k |

Subagents are not the leak: a report costs 0.3k and the work happens in a window
nobody pays to replay. The leak is the main thread. On a 1M window the
compaction threshold (967k) never arrives, so a session rides at 700k and every
request re-reads the pile.

## Decisions

| # | Decision | Reason |
|---|---|---|
| 1 | The window is **400k**, set as `autoCompactWindow` in `~/.claude/settings.json`. The threshold is then 367k and the warn 275k. | 200k was below where sessions do their work. Measured over the 99 sessions that ran under it: 3 compacted, and 5 ran past 200k coherent, one to 314k. 400k keeps ~92k of runway after the warn and holds cache reads near 168k a request, against 469k at a 1M window. |
| 2 | `bashOutputMaxChars` is **8000** (30000 is the default, 4000–128000 the clamp). | The cap binds at the tail: the largest Bash result measured was 7,425 tokens, exactly the 30000-char cap, and the top 10% of calls carry 57% of Bash tokens. Worth ~10k tokens a session, no more. |
| 3 | **Trigger:** fill from the last assistant request in the transcript; the window from `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, then the `autoCompactWindow` setting, then 1M; the threshold is window − 33k. | The same places Claude Code reads them. 33k is `min(maxOutput, 20k) + 13k`, measured in 2.1.283. |
| 4 | **Warn** above 0.75 of the threshold: a `systemMessage` to Chris, the turn passes. It names the budget, not a prediction. `ALEPH_CONTEXT_WARN` moves the fraction. | The decision to end a session is Chris's, and a warning at 275k leaves ~92k to finish the thought. The setting does not reliably force compaction, so the warn claims only what it knows. |
| 5 | **Gate** once the session has compacted: block the Stop with a reason that asks for `aleph:handoff` and a `/clear`. Once a session, never on a retry. A `microcompact_boundary` is not compaction. | After a compaction the context is a summary; a handoff written from the summary is worse than one written now. Blocking twice is a stuck turn. Microcompaction only evicts old tool results, so the conversation survives, and it fires early in a tool-heavy session while lowering the fill. |
| 6 | **Scope:** main agent `Stop` only. No span, no score. | Subagents report to the main agent. `obs.ts` already records the Stop event, and the verdict is in the transcript. |

## Mechanism

```
Stop   context-gate.ts
         not Stop, no session_id, no transcript → exit
         read the transcript: last assistant usage → fill
                              compact_boundary | isCompactSummary → compacted
         compacted, not gated yet, not a retry → {"decision":"block","reason":…}, mark ~/.aleph/spool/ctx:<session>
         fill ≥ 0.75 × threshold                → {"systemMessage":"Context 290k of the 367k budget…"}
         otherwise                              → silent
```

`systemMessage` on `Stop` displays to Chris without blocking; `{"decision":"block"}`
is the shape `Stop` honors, as with the verify gate.

## Where the rest of the aggression lives

- Delegate read-heavy and search-heavy sweeps. Measured: 3% of the tokens, 0.3k
  back into the parent.
- `/aleph:handoff` then `/clear` then `/aleph:pickup` is the session boundary.
  The gate only decides when.
