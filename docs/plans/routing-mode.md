# Plan: drop depth classification; add composable SuperClaude-style modes

## Context

Current `src/core/hooks/routing-classify-submit.ts:50-61` runs binary `FULL | QUICK` detection (`archPattern` regex + ≥40-word floor) and emits a "use design-first pipeline" reminder. The signal isn't load-bearing; no peer formalizes depth tiers. Drop it.

Prior version of this plan modeled a `mode` axis as three mutually-exclusive values (`explore | commit | cautious`). Reviewed SuperClaude's actual implementation (`~/personal-ai-projects/SuperClaude_Framework/src/superclaude/modes/MODE_*.md`) — their approach is stronger:

- **Composable**, not mutually exclusive. Brainstorming + Token_Efficiency can both be active.
- **No default mode**. Modes are opt-in shifts away from baseline; absence of any active mode is the common case.
- **Each mode is a standalone behavior file**, not just a signal name. `MODE_Brainstorming.md` *is* the behavior contract — activation triggers, behavioral changes, outcomes, examples. Claude reads it; the hook just decides which to surface.
- **Multiple activation channels**: keyword regex, slash flag (`/sc:research`), manual CLI flag (`--brainstorm`), resource threshold (context >75%).

Adopting this shape.

## Mode set (first cut)

Three modes for the initial implementation. Adapt-from-peer, not invent-from-scratch:

| Mode | Adapted from | Trigger | Purpose |
|---|---|---|---|
| **explore** | MODE_Brainstorming | "thinking about", "maybe", "not sure", "what could", "how should", question framing; `--explore` flag | Socratic questions; recommendation + tradeoff; no implementation; ends with a brief if the user asks for one |
| **cautious** | (Construct-original — no SuperClaude analog) | `/\b(production|prod\b|live|shared|irreversible|drop\s+(table|database)|delete\s+(from|branch)|force.?push|rm\s+-rf)\b/i`; `--cautious` flag | Confirm before each non-trivial action; refuse `--no-verify`-style bypasses; flag blast radius |
| **introspect** | MODE_Introspection | "why did that fail", "analyze my reasoning", verify-gate failure, `--introspect` flag | Annotate own reasoning; identify pattern across past failures; check against project rules |

Composable: any subset can be active simultaneously. Hook reports the full active set.

Deferred modes (worth filing but not in this cut): `research` (already covered by `/research` skill), `task-manage` (overlaps with TodoWrite usage rules), `efficient` (context-pressure compression).

## Mode file format

Each mode is a standalone markdown file at `src/modes/MODE_<name>.md`. Structure mirrors SuperClaude:

```markdown
# <Name> Mode

**Purpose**: <one-line>

## Activation Triggers
- <regex / keyword list>
- Manual flag: `--<name>`

## Behavioral Changes
- <bullet list of posture shifts>

## Outcomes
- <what the user should get>

## Examples
<before/after pairs>
```

Files install to `~/.claude/construct/modes/MODE_<name>.md` via `bun install.ts` (no transformation, plain copy).

## How mode content reaches Claude

**Risk:** cite-by-path is not reliable. Hook saying "see `MODE_explore.md`" doesn't guarantee Claude reads it. (Confirmed in prior session — same reason omnibus is being dissolved in favor of inlined orchestration.)

Three candidate mechanisms:

| Mechanism | How it works | Tradeoff |
|---|---|---|
| **M1: inline in hook stdout** | Hook reads the active MODE files and prints their content into UserPromptSubmit output | Guaranteed presence; bloats every prompt's context (~200-600 tokens per active mode) |
| **M2: system-reminder injection** | Hook writes mode content as a `<system-reminder>` payload | Lives in conversation context, not every turn; depends on harness behavior |
| **M3: @-include in CLAUDE.md** | `src/core/CLAUDE.md` `@-includes` all MODE files; always loaded at session start | Always-on at session start; can't activate/deactivate mid-session; can't show only active modes |

**Default: M1** for the first cut. Token cost is bounded (≤3 modes × ~400 tokens = ~1200 tokens worst case) and presence is guaranteed. Revisit if cost becomes a problem.

## Hook output shape

```
[Construct] Modes active: explore, cautious

<full inlined content of MODE_explore.md>

---

<full inlined content of MODE_cautious.md>

[Construct] Matched skills: code-review, git. Activate via Skill() before proceeding.
```

If no modes active: no mode block printed. Skill-matching output unchanged.

## Activation channels (in order)

1. **Manual flag at end of prompt**: `... --explore`, `... --cautious`, `... --introspect`. Stripped from the prompt before further processing.
2. **Keyword regex** per mode. Multiple modes can match simultaneously.
3. **Threshold-based** (future, not in first cut): context % usage, error-recovery state.

## Files to modify

| File | Change |
|---|---|
| `src/core/hooks/routing-classify-submit.ts` | Remove depth logic (lines 50-61, 122); add mode detector; read MODE files; inline content per active mode |
| `src/modes/MODE_explore.md` | **NEW** — Brainstorming-adapted contract |
| `src/modes/MODE_cautious.md` | **NEW** — Construct-original |
| `src/modes/MODE_introspect.md` | **NEW** — Introspection-adapted contract |
| `src/core/hooks/routing-classify-submit.test.ts` | **NEW** — per-mode + multi-mode fixtures |
| `install.ts` | Add modes/ to copy list if not already in the generic walk |
| `docs/specs/HOOKS.md` | Document new signal shape; remove depth references |
| Observability UI consumer of `directives: ["full"]` | grep; update to read `directives: ["mode:explore", "mode:cautious"]` |

Directive log: `directives.push("mode:" + name)` for each active mode. `meta.modes: string[]` in `reportHook`.

## Out of scope (deferred)

- **Persona axis** — `docs/plans/personas.md`. Modes ≠ personas; personas are identity (Engineer/Architect/QATester), modes are posture. SuperClaude separates them too. Land modes first.
- **Safety enforcement** — `docs/plans/safety-gates.md`. Wire `cautious` into PreToolUse to actually block destructive ops. This plan emits the signal; doesn't enforce.
- **Threshold-based activation** (context >75% → `efficient` mode). Needs the mode set extended first.
- **Mode interaction rules** — when `explore` and `cautious` co-activate, which wins on conflict? Punt until observed.

## Risks

| Risk | Mitigation |
|---|---|
| Inlining mode content bloats context | Bound: ≤3 modes × ~400 tokens. Profile against real session prompts before deciding to switch to M2/M3 |
| Mode content not actually read despite inlining | Test live: type "what could we do about X" → confirm Claude responds in explore-mode posture |
| `cautious` regex over-fires ("live reload", "delete this comment") | Word boundaries + narrow initial list; corpus check before merging |
| Manual flag (`--explore`) collides with shell flags in copy-pasted commands | `--` flag must be at end-of-prompt OR preceded by whitespace; not parsed mid-sentence |
| Drift between MODE files and the prose describing modes in CLAUDE.md / agent docs | Single source: MODE files. Anywhere else that mentions modes links to the file |

## Verification

1. `routing-classify-submit.test.ts`: ≥3 fixtures per single mode (9+), ≥3 fixtures for multi-mode activation, ≥3 for no-mode prompts.
2. Corpus check: pipe user prompts from `~/.claude/projects/-home-crsmi-construct/*.jsonl` through the hook; print activation distribution. No mode should fire >70% (over-broad) or <2% (dead trigger).
3. `bun install.ts && bun test.ts` — MODE files deploy to `~/.claude/construct/modes/`; existing tests pass.
4. Live-fire: type each trigger; confirm hook output names the mode AND inlines its content; confirm Claude's next response reflects the mode's posture.

## Open questions

1. **Three modes, or pull in `research` and `task-manage` from SuperClaude in the same pass?** Default: three. Adding more is cheap follow-up once the plumbing works.
2. **Inline-everything (M1) vs system-reminder (M2) vs CLAUDE.md @-include (M3)?** Default: M1.
3. **Manual flag syntax — `--explore` (CLI-style) or `:explore` (Construct-original)?** SuperClaude uses `--`; defaulting to match.
