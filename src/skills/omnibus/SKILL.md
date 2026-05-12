---
name: omnibus
description: Run a verb across one or many domains in parallel, merge findings, present a phased report, and dispatch fixes after approval. ONLY this skill calls other skills — leaves are pure. Triggers on /audit, /fix, /suggest, or any cross-domain "review everything" / "check all the things" request.
---

# Omnibus

Cross-domain orchestrator. Reads `omnibus.yml`, dispatches verb+domain combinations to leaf skills in parallel, merges SARIF findings, runs a validation pass, presents a phased report, and (for the `fix` verb) routes approved findings to `<domain>-fix` leaves.

**The omnibus is the only skill that invokes `Skill()`.** Leaves are pure and read-only with respect to each other; orchestration logic lives here.

## Invocation forms

```
/audit                     → all populated audit cells
/audit code                → row slice: code-audit only
/audit code design         → multi-domain audit
/audit --module src/foo    → narrowed scope, all audit cells
/audit --threshold 60      → widen to lower-confidence findings
/audit --all               → full codebase scan, all audit cells
/fix                       → all populated fix cells (requires prior approved audit findings)
/fix code                  → fix only the code domain
/suggest                   → all populated suggest cells (proactive)
```

Argument grammar:

- First positional (optional): one or more domain names from `omnibus.yml` `active.<verb>`.
- `--scope <diff|module|all>` or shorthand `--module <path>` / `--all`.
- `--threshold N` — confidence floor (0-100); overrides `defaults.threshold`.
- `--phase blocking,important` — which severity tiers to include.

## Pre-flight (cheap, Haiku-class)

Before dispatching:

1. **Skip-conditions** — if invoked against a PR, skip when the PR is closed / draft / trivially small / already-reviewed-by-this-skill.
2. **Read `omnibus.yml`** — load `defaults`, `active`, `leaves`, `verification`, `approval` blocks.
3. **Resolve registry** — for each (verb, domain) cell requested, look up the leaf skill name. Cells with no leaf are skipped silently with a "Skipped: <domain> — no leaf installed" line in the final report.

Registry (current — all audit + fix cells populated, suggest pending):

| Verb | code | design | docs | skills | hooks | agents | config | security |
|---|---|---|---|---|---|---|---|---|
| audit | `code-audit` | `design-audit` | `docs-audit` | `skills-audit` | `hooks-audit` | `agents-audit` | `config-audit` | `security-audit` |
| fix | `code-fix` | `design-fix` | `docs-fix` | `skills-fix` | `hooks-fix` | `agents-fix` | —¹ | `security-fix` |
| suggest | — | — | — | — | — | — | — | — |

All audit and fix leaves emit SARIF natively per `src/skills/_shared/finding.md`. The `author` verb (`docs-author-v2`, `skill-creator`) is invoked directly per artifact creation rather than orchestrated through the matrix.

¹ `config-fix` is intentionally omitted: config writes are schema-driven and `agnix --fix-safe` handles structural lint. See architecture doc §8.

## Phase 1: Fan out (parallel)

For each (verb, domain) cell with a leaf in the registry, invoke `Skill('<leaf-name>')` in parallel. Pass:

- `scope` — resolved per `defaults.scope` and CLI overrides
- `reference` — if the user named one
- `mode` — always `report-only` for this phase, even on `/fix` invocations (fix happens after approval)
- `threshold` — provisional only; the validation pass refines

Each leaf returns a SARIF v2.1.0 run plus a prose phased summary. Capture both; merge the SARIF, keep the prose for context.

## Phase 2: Validation pass

For each candidate finding from Phase 1, run a validation subagent (a separate `Skill()` invocation or inline reasoning) that:

- Reads the finding's `ruleId`, `message`, `location`, and original `properties.confidence`.
- Re-reads the cited code lines to confirm the violation is real.
- Considers the negative-filter list (per `src/skills/_shared/finding.md`).
- Returns a final `properties.confidence` in 0-100.

Findings whose validated confidence falls below `defaults.threshold` (or `--threshold`) are dropped before the report.

This pass is the primary noise-suppressor. Per Anthropic's `code-review` plugin: confidence scoring with a threshold is what keeps low-quality findings out of the report.

## Phase 3: Merge + dedupe

Combine all SARIF runs into one multi-run SARIF log. Dedupe `results` on `(artifactLocation.uri, region.startLine, ruleId)` — keep the most specific cite, prefer higher confidence as tiebreaker.

When multiple leaves flag the same location with different rules (e.g. `code-audit` and `security-audit` both flagging a hardcoded secret), keep both — they cite different rules and inform different fix paths.

## Phase 4: Report

Group findings by `properties.severity` first, then by `domain`, then by originating skill.

```
# Omnibus <verb> — <scope>

## Summary
N blocking · N important · N nit · N suggestion · N learning · N praise
Domains run: <list>   Domains skipped: <list with reasons>

## blocking
[code-audit] src/research/src/providers/websearch.ts:209 — code/RULES.md#H.3 — confidence 88
  Catch returns '' on any error; failure mode invisible. Fix: log + tagged-result type.
  [tag: silent-fail] [approval: single]

## important
...

## praise
[code-audit] src/research/src/providers/websearch.ts:106 — code/RULES.md#H.3 — confidence 95
  Circuit breaker disables Jina after first 402; surfaces failure instead of swallowing.
  Use as reference for: failure-informative error handling across other providers.
```

For each finding, surface the approval mode it'll need (from `omnibus.yml` `approval` block — by severity, by domain, by tag, most-specific wins).

## Phase 5: Approval gate

Present the report. Offer approval shapes per `omnibus.yml`:

- **all** — approve everything in this report at once (only available if no finding requires `per-finding`).
- **by-phase** — approve all `blocking` first, then all `important`, etc.
- **by-domain** — approve all `code` findings, then all `design`, etc.
- **individual** — every finding asked individually (mandatory for any with `approval: per-finding`).

For `/audit` and `/suggest` invocations, this is the end — no fix dispatch. The user has the report; they can run `/fix` later (which re-runs audit, presents findings, and dispatches fixes).

For `/fix` invocations: proceed to Phase 6 only with explicit approval.

## Phase 6: Fix dispatch (only on `/fix` verb after approval)

Group approved findings by `domain`. For each domain with approved findings:

1. Invoke `Skill('<domain>-fix')` with the SARIF subset for that domain.
2. Wait for the fix skill to return with edits applied + `gate("<domain>")` verification.
3. If the gate failed, stop. Surface the failure as a new finding (typically `severity: blocking`, `tag: regression`).

Run domains in parallel within a phase (blocking first, then important, etc.). Sequential across phases — finish all blocking fixes and verify before starting important fixes.

After all approved findings are applied and gates are green, output a closing summary:

```
# Omnibus fix — complete

Applied: N findings across M domains
Files touched: <count> across <list of domains>
Gates run: code (green), design (green), ...

Skipped:
- <finding> — gate failed after fix; rolled back
- <finding> — user declined per-finding approval

Re-audit suggested: <reason>
```

## Today's limitations

- `suggest` cells are declared in `omnibus.yml` but not yet wired — the proactive-suggestion variant of audit is post-v1 work.
- No persistence — findings live for the duration of the conversation. A `/audit` followed an hour later by `/fix` requires re-running the audit.
- No graph-index for cross-file checks. Per-file scans only. Graph-index audit (Greptile v3 pattern) is post-v1 work.
- Approval gates use AskUserQuestion or simple chat prompts; no UI surface yet.

## Guardrails

- **R1: Only this skill calls `Skill()`.** Leaves never chain. If a leaf appears to need to invoke another leaf, surface it as a finding with a routing tag and let the omnibus dispatch.
- **Read-only by default.** Fix dispatch requires explicit user approval, every time.
- **No silent skips.** Every registry entry either runs or is reported as skipped with a reason.
- **Per-domain gates are non-negotiable.** No phase advances until all touched-domain gates are green.
- **Risk-tiered approval is non-negotiable.** Security / auth / payments / RCE / injection / crypto findings ALWAYS require per-finding approval, regardless of severity.
- **The validation pass is the second line; the leaf's negative-filter is the first.** Both must run.

## Cross-references

- Per-project config: `omnibus.yml` (defaults, active leaves, approval policy)
- Finding contract: `src/skills/_shared/finding.md`
- Verification gates: `VERIFICATION.md`
- Architecture: `docs/plans/skill-architecture.md`
- Code domain leaves: `src/skills/code-audit/SKILL.md`, `src/skills/code-fix/SKILL.md`
- Code rules: `src/rules/code/RULES.md`
