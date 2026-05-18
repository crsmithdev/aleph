# Plan: drop depth classification; add mode signal to routing hook

## Context

Current `src/core/hooks/routing-classify-submit.ts:50-61` runs binary `FULL | QUICK` detection: `archPattern` regex + word-count floor of 40. The signal drives one downstream behavior — a `console.log` reminder to "use design-first pipeline". Model behavior is unchanged regardless.

Peer survey (5 projects under `~/personal-ai-projects/`): **no peer formalizes depth tiers**. SuperClaude ships the closest analog — 7 declarative behavioral modes (`src/superclaude/modes/MODE_*.md`), each a posture/communication-style set. BMAD-METHOD, superpowers, wshobson-agents, awesome-claude-agents, everything-claude-code all skip depth entirely. Construct's depth classification is unique and isn't load-bearing — drop it.

What's worth keeping from the routing-tiers exploration is the **mode dimension** (explore / commit / cautious). That converges with SuperClaude's prior art and gives the hook a useful signal it doesn't have today.

## What changes

### Remove from `routing-classify-submit.ts`

| Lines | Code | Why |
|---|---|---|
| 50-52 | `archPattern` regex + `isFull` flag | Unused signal |
| 53-61 | Depth console.log branches | Output Claude ignores |
| 122 | `if (isFull) directives.push("full")` | Dead directive |

The `isQuestion` regex at line 63 stays — repurposed as the `mode=explore` trigger.

### Add mode detector

| Mode | Trigger | Hook output |
|---|---|---|
| **explore** | `isQuestion` regex (existing, line 63) — starts with what/how/why/etc. | `[Construct] Mode: explore — recommendation + tradeoff in 2-3 sentences, no implementation.` |
| **cautious** | New regex: `/\b(production|prod\b|live|shared|irreversible|drop\s+(table|database)|delete\s+(from|branch)|force.?push|rm\s+-rf)\b/i` | `[Construct] Mode: cautious — confirm before each non-trivial action.` |
| **commit** | Default for everything else | Silent |

Mode is mutually exclusive; precedence is `cautious > explore > commit` (risk keywords win over question framing).

### Directive log

Replace `directives.push("full")` with `directives.push("mode:" + mode)`. Add `meta.mode` to the `reportHook` call so observability can group by mode.

## Files to modify

| File | Change |
|---|---|
| `src/core/hooks/routing-classify-submit.ts` | Remove depth logic; add mode detector; update `reportHook` meta |
| `src/core/hooks/routing-classify-submit.test.ts` | **NEW** — ≥3 fixtures per mode |
| `docs/specs/HOOKS.md` | Update signal-shape section; remove "depth" references |
| Any consumer of the `directives: ["full"]` shape | grep first; the observability UI is the likely consumer — degrade gracefully if the field disappears |

## Out of scope (deferred)

- **Personas** — `docs/plans/personas.md`. Depends on mode landing. SuperClaude's `MODE_*.md` is the prior art; the four-axis finding (lifecycle / domain / behavioral / voice) belongs there.
- **Safety enforcement** — `docs/plans/safety-gates.md`. Wire `mode=cautious` into a PreToolUse hook to actually block destructive ops. This plan keeps `cautious` as signal-only.
- **User overrides** (`/full ...`, `/trivial ...`) — would reintroduce depth. Not building.

## Risks

| Risk | Mitigation |
|---|---|
| Removing the `Depth: FULL` output breaks a consumer | grep `"Depth:"` and `directives.*full` across the repo before deleting; update SessionsPage/LearningPage if they read it |
| `cautious` regex over-fires (e.g. matches "live reload") | Start narrow, expand on observed false negatives. Word boundaries on every keyword |
| `commit` is the default → most prompts emit nothing | Acceptable. Signal value sits in the two non-default cases |
| Hook signal shape change isn't covered by tests | New `.test.ts` is required, not optional |

## Verification

1. `routing-classify-submit.test.ts` — ≥3 fixtures per mode (9+ total). Each asserts `mode` + `directives` shape.
2. Corpus check: extract user prompts from `~/.claude/projects/-home-crsmi-construct/*.jsonl`, pipe through the hook, print mode distribution. Sanity-check: `commit` should dominate, `explore` 15-30%, `cautious` <5%.
3. `bun install.ts && bun test.ts` — installed hook deploys; existing tests pass.
4. Live-fire in a real session: ask a "what could we" prompt → expect `Mode: explore`; type a "drop the prod table" prompt → expect `Mode: cautious`.

## Open questions

1. **Keep the `isQuestion` regex name, or rename to `isExplore`?** Renaming is clearer but touches more lines. Default: rename.
2. **Emit `Mode: commit` silently, or print it for consistency?** Silent matches current QUICK behavior — no noise on the common path. Default: silent.
