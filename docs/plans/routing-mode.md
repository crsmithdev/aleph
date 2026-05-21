# Plan: drop depth classification; add composable behavioral modes

## Context

Current `src/core/hooks/routing-classify-submit.ts:50-61` runs binary `FULL | QUICK` detection (`archPattern` regex + ≥40-word floor) and emits a "use design-first pipeline" reminder. The signal isn't load-bearing.

Survey of `~/personal-ai-projects/` (verified against each repo's source, not summaries): six peers ship a depth/complexity signal — SuperClaude's `/research depth: quick/standard/deep/exhaustive`, BMAD's `domain-complexity.csv` in the architecture skill, wshobson-agents' `plugin-eval --depth quick/standard`, claude-code-hooks-mastery's `/plan complexity (simple|medium|complex)`, everything-claude-code's `/plan` complexity estimate, claude-task-master's `/taskmaster:analyze-complexity` task report. **All six scope the signal to a specific command or skill** — none stamp every user prompt globally. Construct's binary FULL/QUICK classifier on every prompt is the outlier shape.

Drop the global classifier. If depth ever matters, scope it per-skill (matching the peer consensus).

Replace with a composable mode system synthesized from SuperClaude (`~/personal-ai-projects/SuperClaude_Framework/src/superclaude/modes/MODE_*.md`) and Roo/Kilo Code's `whenToUse` natural-language matching:

- **Composable**, not mutually exclusive. Any subset can be active simultaneously.
- **No default mode**. Modes are opt-in shifts away from baseline; absence is the common case.
- **Each mode is a standalone behavior file** with its own activation contract.
- **No `--flag` or `:flag` activation**. Two channels: regex match (cheap, deterministic) and model self-selection via `whenToUse` strings (Roo/Kilo pattern — the model reads the strings and picks modes itself).

## Mode set

Six modes. Five are temperament/discourse overlays; `focused` is a scope overlay. All compose orthogonally.

| Mode | Axis | Adapted from | Purpose |
|---|---|---|---|
| **execution** | action orientation | (Construct-original) | Bias toward dispatch — treat the request as a task to ship, not a question to discuss. Fan out subagents when work is independent. Pick a path and execute |
| **brainstorming** | deliberation | MODE_Brainstorming | Generate options before committing to one. Ask before assuming. Surface 2–3 alternatives with tradeoffs. No code edits until *what* is settled |
| **introspection** | transparency | MODE_Introspection | Narrate the reasoning, not just the result. Emit *why this, not the alternative* before significant actions. Acknowledge guessing vs. knowing |
| **efficiency** | output density | MODE_Token_Efficiency | Maximize information per token. Symbol-dense output. Drop headers, examples, prose-restating-what-code-does. Targets ~50% token reduction |
| **focused** | scope discipline | (Construct-original) | Touch only what was asked. Log adjacent findings to a list; do not fix them. Counter-bias against the listed "completionism" failure mode |
| **comparison** | peer/precedent awareness | (Construct-original) | Surface 2–3 peer projects, prior art, or existing patterns with every substantive answer. Reverses the synthesize-in-a-vacuum default |

Composable: any subset active simultaneously. Hook reports the full active set.

Six modes only — `adversarial`, `durable`, and `forward` are dropped from scope (not deferred, not filed). Add later if a real need surfaces; easier to add than to remove.

## Mode file format

Each mode is a standalone markdown file at `src/modes/MODE_<name>.md`. Frontmatter follows a Roo/Kilo-extended schema so the same file serves both regex activation and `whenToUse` model-driven activation:

```markdown
---
slug: brainstorming
whenToUse: |
  When the user is uncertain, generating options, scoping vague work, or asking
  "should we" / "what if" / "how might we". Pair with comparison if peer precedent
  would help anchor the options.
triggers:
  - \bshould we\b
  - \bwhat if\b
  - \bhow might we\b
  - \bnot sure\b
  - \bthinking about\b
  - \boptions\b
---

# Brainstorming Mode

**Purpose**: <one-line>

## Behavioral Changes
- <bullet list of posture shifts>

## Outcomes
- <what the user should get>

## Examples
<before/after pairs>
```

Files install to `~/.claude/construct/modes/MODE_<name>.md` via `bun install.ts` (plain copy).

## Activation channels (in order)

1. **Keyword regex** (`triggers` array in frontmatter). Cheap, deterministic. Multiple modes can match simultaneously. Hook activates and inlines content.
2. **Model self-selection via `whenToUse`**. All mode `whenToUse` strings live in an always-loaded mode index (`src/modes/INDEX.md`, `@-included` from `src/core/CLAUDE.md`). When no regex fires, the model reads the request, decides if any mode applies, and narrates the choice. This is the Roo/Kilo pattern — natural-language matching by the model itself, not by the hook.
3. **Threshold-based** (future, not in this cut): context % usage, error-recovery state, turn count.

**No flag-based activation.** `--explore` / `:explore` / equivalents are explicitly rejected. The user shouldn't have to learn a syntax; regex catches the common cases, `whenToUse` catches the rest.

## How mode content reaches Claude

**Risk:** cite-by-path is not reliable. Hook saying "see `MODE_brainstorming.md`" doesn't guarantee Claude reads it.

| Mechanism | How it works | Tradeoff |
|---|---|---|
| **M1: inline in hook stdout** | Hook reads active MODE files and prints their content into UserPromptSubmit output | Guaranteed presence; bloats every prompt's context (~200–600 tokens per active mode) |
| **M2: system-reminder injection** | Hook writes mode content as a `<system-reminder>` payload | Lives in conversation context, not every turn; depends on harness behavior |
| **M3: @-include in CLAUDE.md** | Index of `whenToUse` strings is always-loaded; mode bodies fetched only when active | Hybrid — enables model self-selection without inlining bodies until activation |

**Default: M3 for the `whenToUse` index, M1 for activated mode bodies.** The index is small (~6 modes × ~3 lines `whenToUse` = ~50 tokens always-on). Activated bodies inline only when fired.

## Hook output shape

When at least one mode activates:

```
[Construct] Modes active: brainstorming, comparison

<full inlined content of MODE_brainstorming.md>

---

<full inlined content of MODE_comparison.md>

[Construct] Matched skills: code-review, git. Activate via Skill() before proceeding.
```

When no modes activate: no mode block printed (model may still self-select via `whenToUse` strings in the index). Skill-matching output unchanged.

## Files to modify

| File | Change |
|---|---|
| `src/core/hooks/routing-classify-submit.ts` | Remove depth logic (lines 50-61, 122); add mode detector; read MODE files; inline content per active mode |
| `src/modes/INDEX.md` | **NEW** — assembled from each MODE's frontmatter `whenToUse`; @-included from `src/core/CLAUDE.md` |
| `src/modes/MODE_execution.md` | **NEW** — Construct-original |
| `src/modes/MODE_brainstorming.md` | **NEW** — Brainstorming-adapted |
| `src/modes/MODE_introspection.md` | **NEW** — Introspection-adapted |
| `src/modes/MODE_efficiency.md` | **NEW** — Token-Efficiency-adapted |
| `src/modes/MODE_focused.md` | **NEW** — Construct-original |
| `src/modes/MODE_comparison.md` | **NEW** — Construct-original |
| `src/core/hooks/routing-classify-submit.test.ts` | **NEW** — per-mode + multi-mode fixtures |
| `src/core/CLAUDE.md` | `@-include modes/INDEX.md` |
| `install.ts` | Add `src/modes/` to copy list if not already in the generic walk |
| `docs/specs/HOOKS.md` | Document new signal shape; remove depth references |
| Observability UI consumer of `directives: ["full"]` | grep; update to read `directives: ["mode:brainstorming", ...]` |
| `~/.local/bin/cc-statusline/routing.sh` | Repurpose into the modes block — strip `mode:` prefix, relabel `route:`→`modes:`, distinct color. Keeps last-prompt semantics (active modes, not session union). Rename file to `modes.sh` |
| `~/.config/ccstatusline/settings.json` | Point the `l2-routing` widget (already next to `l2-skills`) at `modes.sh`; rename id `l2-routing`→`l2-modes` |

Directive log: `directives.push("mode:" + name)` for each active mode. `meta.modes: string[]` in `reportHook`.

**Statusline note:** post-plan the classifier pushes only `skill:*` and `mode:*` directives (the `full` depth push is removed). `routing.sh` already shows the last prompt's non-skill directives — which become exactly the active modes — so the existing line-2 block next to `l2-skills` is the modes block with no new widget. The cc-statusline scripts are hand-maintained dotfiles outside any repo; edit in place.

## Out of scope (deferred)

- **Persona axis** — `docs/plans/personas.md`. Modes ≠ personas; personas are identity (Engineer/Architect/QATester), modes are posture. SuperClaude separates them; do the same. Land modes first.
- **Threshold-based activation** (context >75% → `efficiency`, error-recovery → `introspection`). Needs the mode set settled first.
- **Mode interaction rules** — when two modes give conflicting guidance, which wins? Punt until observed in real sessions.

## Risks

| Risk | Mitigation |
|---|---|
| Inlining mode bodies bloats context | Bound: ≤6 modes × ~400 tokens = ~2400 tokens worst case (all active). Realistic active count is 1–3. Profile against real sessions; switch to M2 if cost is real |
| `whenToUse` strings in always-loaded index also bloat baseline | Index is ~50 tokens — `whenToUse` strings are 1–3 lines each. Negligible vs. existing CLAUDE.md size |
| Mode content not actually read despite inlining | Live test: type each trigger, confirm Claude's next response reflects the mode's posture (not just acknowledges the mode block) |
| Regex over-fires (`focused` hitting "focused on the user", `comparison` hitting "compare A and B" in casual reference) | Word boundaries + narrow initial trigger list; corpus check before merging; `whenToUse` is the backstop for genuine matches the regex misses |
| Model self-selection silently disagrees with regex (both fire, regex activates X, model thinks Y) | Hook output is authoritative — model sees which modes the hook activated and shouldn't override silently. If observed, add an "active modes" assertion to the mode bodies |
| Drift between MODE files and CLAUDE.md / agent docs prose | Single source: MODE files. Anywhere else that mentions modes links to the file |

## Verification

1. `routing-classify-submit.test.ts`: ≥3 fixtures per single mode (18+), ≥3 fixtures for multi-mode activation, ≥3 for no-mode prompts.
2. Corpus check: pipe user prompts from `~/.claude/projects/-home-crsmi-construct/*.jsonl` through the hook; print activation distribution per mode. No mode should fire >70% (over-broad) or <2% (dead trigger). Reject any regex outside that band before merging.
3. `bun install.ts && bun test.ts` — MODE files deploy to `~/.claude/construct/modes/`; INDEX assembled; existing tests pass.
4. Live-fire (manual): for each mode, type a trigger phrase; confirm hook output names the mode AND inlines its content; confirm Claude's next response reflects the mode's posture. Repeat for two-mode and three-mode prompts.
5. `whenToUse` self-selection check: type a prompt that should match `whenToUse` but NOT the regex (e.g. an oblique "I'm trying to decide between X and Y" — should activate `brainstorming` + `comparison` via the model reading the index). Confirm model narrates the activation.

## Decisions (resolved)

1. **Mode set:** six. `adversarial` / `durable` / `forward` dropped from scope entirely — not deferred, not filed. Add later only if a real need surfaces.
2. **Active-mode delivery:** M1 — inline the full MODE body into hook stdout. Guaranteed presence; revisit if context cost is felt.
3. **`whenToUse` self-selection surfacing:** explicit, one short line (e.g. "Activating brainstorming because the request is exploring options"), so the user can see and correct. **Plus:** active modes render in the cc-statusline line-2 block next to loaded skills (see Files to modify — `routing.sh`→`modes.sh`).
