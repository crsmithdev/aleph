# Plan: replace binary QUICK/FULL routing with multi-axis tiered routing

## Context

Today's routing is in `src/core/hooks/routing-classify-submit.ts:51-61`. One regex (`archPattern`) + a word-count floor (≥40) produces a binary `FULL | QUICK` signal. The signal feeds one downstream behavior: emit a "use design-first pipeline" reminder.

Peer survey (`~/personal-ai-projects/`, 20 projects, comparison.md dated 2026-05-17) shows the ecosystem routes on **three** independent dimensions, not one. Construct collapses all three into a single archPattern boolean and only acts on the depth dimension. The other two dimensions are unused.

Source session: `~/.claude/projects/-home-crsmi-construct/8e47005b-…jsonl` + continuation `31979d58-…jsonl`. The original "richer than two tiers" question was raised, surveyed, then never landed — the session drifted into the omnibus restructure plan (`~/.claude/plans/why-is-the-sarif-stateless-garden.md`).

## Findings (from the peer survey)

### Three axes peers route on

| Axis | What it answers | Best peer example | Construct today |
|---|---|---|---|
| **Depth** | how much process to apply | BMAD-METHOD (`bmad-help` infers scale + adapts planning depth) | binary FULL/QUICK regex |
| **Domain** | which expertise/rules apply | wshobson (185 specialists), SuperClaude (20), awesome-claude-agents (33) | skill keyword matcher (separate from depth signal) |
| **Mode** | what posture to take — explore vs commit, cautious vs fast | SuperClaude (claimed, weakly exemplified) — **ecosystem gap** | not represented |

### Depth tier proposal (from the unimplemented recommendation)

| Tier | Wall-clock | Scope | Trigger heuristics |
|---|---|---|---|
| **TRIVIAL** | 1–5 min | 1 file, no deps | typo/test fix/grep, ≤10 words, no archPattern |
| **QUICK** | 5–20 min | ≤3 files, local | current QUICK default, ≤40 words, no archPattern |
| **STANDARD** | 20 min–2 hr | module-scope | one archPattern keyword OR 40–80 words OR 2+ skills matched |
| **FULL** | 2–8 hr | system-scope | current FULL default — archPattern + ≥40 words, or ≥2 archPattern hits |
| **EPIC** | 8 hr+ | multi-system | archPattern + ≥80 words OR ≥3 archPattern hits OR explicit "migrate/rewrite/redesign" |

Cap is heuristic, not enforcement — the model still does what it does. The signal exists so the hook can emit appropriately scaled guidance ("just do it" vs "design-first pipeline" vs "open a plan file first").

### Mode dimension (separate from depth)

| Mode | Trigger | Posture |
|---|---|---|
| **explore** | "what could", "how should", "options", "ideas", "thoughts" | 2-3 sentences, recommendation + tradeoff, no implementation |
| **commit** | imperative verbs ("add", "fix", "remove", "implement") | proceed without asking, design-first only at STANDARD+ |
| **cautious** | "production", "prod", "live", "shared", "irreversible", "delete", "drop", `git push --force` mentions | confirm before each non-trivial action regardless of depth |

This already exists informally in `CLAUDE.md` ("For exploratory questions … respond in 2-3 sentences with a recommendation"), but it's not detected by a hook, so the signal isn't durable or observable.

## Design

### Hook output (proposed)

`routing-classify-submit.ts` emits three orthogonal signals instead of one:

```
[Construct] Depth: STANDARD — module-scope change.
[Construct] Mode: commit — proceed without asking.
[Construct] Matched skills: code-review, git. Activate via Skill() before proceeding.
```

Each signal is computed independently from the same prompt. Skill matching unchanged.

### Directive log (proposed)

`reportHook` already writes `directives: ["full", "skill:git"]`. Extend with two more keys so the observability UI can show depth/mode distribution:

```ts
meta: {
  directives,                                  // unchanged
  depth: "TRIVIAL"|"QUICK"|"STANDARD"|"FULL"|"EPIC",
  mode: "explore"|"commit"|"cautious",
  promptWords: words.length,
}
```

### Downstream consumers

Today only one consumer reads the depth signal — the inline `console.log` line in the hook itself. After this change:

- The hook prints scaled guidance per tier (TRIVIAL → silent; QUICK → silent; STANDARD → "consider a brief plan"; FULL → "design-first pipeline"; EPIC → "open a plan file in `docs/plans/`").
- The `mode=cautious` signal is consumable by Stop hooks and the verify gate later — not wired up in this plan.
- SessionsPage / LearningPage can group by depth and mode to surface "where does my time actually go".

## Files to modify

| File | Change |
|---|---|
| `src/core/hooks/routing-classify-submit.ts` | Replace lines 50-61 with tier detector + mode detector. Extend `reportHook` meta. |
| `src/core/hooks/routing-classify-submit.test.ts` | **NEW** — per-tier and per-mode fixtures |
| `src/ui/web/.../SessionsPage.tsx` (TBD path) | Add depth/mode columns or facets — **deferred to a follow-up** |
| `docs/specs/HOOKS.md` | Document the new signal shape |

Single hook file is the entire functional change. Everything else is test + docs.

## Out of scope (deliberately deferred)

- **Persona axes** (lifecycle / domain-specialist / behavioral / voice — the four-axis finding from the survey). Personas are a separate question: today's Engineer / Architect / QATester is a weak hybrid. Worth its own plan after routing lands — adding behavioral-mode personas only makes sense once `mode` is a real signal. File a follow-up: `docs/plans/personas.md`.
- **Omnibus dissolution** — separate plan at `~/.claude/plans/why-is-the-sarif-stateless-garden.md`. Independent of this change. Recent commits (WHAT/HOW split, default-to-whole-codebase) have partially superseded it; close-out is its own task.
- **Rules-sharing restructure** — `src/rules/_shared/` SARIF rename, etc. Out of scope here.

## Risks

| Risk | Mitigation |
|---|---|
| Heuristics misclassify common prompts (false EPIC on routine refactors) | Per-tier test fixtures with a corpus of real prompts from session history; tune thresholds against the corpus |
| Mode detector fires `cautious` too often, becomes noise | Start with a narrow keyword list; expand only after observing false negatives |
| Downstream UI changes blocked on schema migration | Directive log already accepts arbitrary `meta` — additive change, no migration |
| Depth tier inflation (everything becomes STANDARD+) | Test corpus must include a baseline distribution; if STANDARD+ >50% of real prompts, thresholds are wrong |

## Verification

1. `routing-classify-submit.test.ts` — table-driven, ≥3 fixtures per tier (15+ total) and per mode (9+ total). Each asserts depth + mode + skills.
2. Pipe a real prompt corpus through the hook (extract from `~/.claude/projects/-home-crsmi-construct/*.jsonl` user messages) — print distribution. If >50% land in STANDARD+ or <5% in TRIVIAL, thresholds are wrong.
3. `bun install.ts && bun test.ts` — hook deploys; existing tests pass.
4. Live-fire: type a STANDARD-shaped prompt in a session and confirm the hook output names the tier.

## Open questions

1. **Adopt 5 tiers (TRIVIAL/QUICK/STANDARD/FULL/EPIC) or 3 (QUICK/STANDARD/FULL)?** 5 matches the survey recommendation; 3 is less to maintain. Default to 5 unless directed otherwise.
2. **Wire the `cautious` mode into a Stop hook now, or leave it as a signal-only first pass?** Signal-only is the safer first move; wire it after observing real distributions.
3. **Scope: hook + tests + docs (recommended), or fold in the SessionsPage UI columns?** Recommend hook-only first — UI is its own commit once the signal stabilizes.
