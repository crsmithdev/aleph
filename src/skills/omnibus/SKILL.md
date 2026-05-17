---
name: omnibus
description: Run a verb across one or many domains in parallel, merge findings, present a phased report, and dispatch fixes after approval. ONLY this skill calls other skills — leaves are pure. Triggers on /audit, /fix, /suggest, or any cross-domain "review everything" / "check all the things" request.
---

# Omnibus

Cross-domain orchestrator. Reads `omnibus.yml`, dispatches the requested verb to one or more `<domain>-review` leaf skills in parallel, merges SARIF findings, runs a validation pass, presents a phased report, and (for the `fix` verb) re-dispatches approved findings to the same review leaves in `mode: fix`.

**The omnibus is the only skill that invokes `Skill()`.** Leaves are pure and read-only with respect to each other; orchestration logic lives here.

## Invocation forms

```
/audit                     → all populated review leaves in audit mode
/audit code                → row slice: code-review (audit mode) only
/audit code design         → multi-domain audit
/audit --module src/foo    → narrowed scope, all review leaves
/audit --threshold 60      → widen to lower-confidence findings
/audit --all               → full codebase scan
/fix                       → all review leaves in fix mode (re-audits + applies approved)
/fix code                  → fix only the code domain
/fix agent                 → fix the merged config + hooks + skills + personas surface
/suggest                   → all review leaves in suggest mode (proactive — not yet wired)
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
3. **Resolve registry** — for each (verb, domain) cell requested, look up the `<domain>-review` leaf. Cells with no leaf are skipped silently with a "Skipped: <domain> — no leaf installed" line in the final report.
4. **Resolve scope** — compute the concrete file set the leaves will audit. Default `scope: diff` means files changed vs. the merge-base with `main` (`git diff --name-only $(git merge-base HEAD main)..HEAD`). If the user is on `main` with a clean tree, this returns 0 files. Rather than dispatching an empty audit, **auto-fall back to `--since HEAD~10`** — the file set touched by the last 10 commits — and surface a one-line notice in the summary:

   ```
   Notice: scope=diff was empty on clean main; falling back to --since HEAD~10 (N files across M commits).
   ```

   If `--since HEAD~10` is also empty (truly stale branch), surface "scope empty — pass `--all` or `--module <path>` to widen" and exit without dispatching.

   Explicit `--all`, `--module <path>`, or `--since <ref>` overrides skip the fallback chain.

Registry (after consolidation — verb axis collapsed into mode flag, wiring domains merged into `agent`):

| Domain | Leaf | Audit-mode dispatch | Fix-mode dispatch |
|---|---|---|---|
| code | `code-review` ¹ | `Skill('code-review', mode: audit)` | `Skill('code-review', mode: fix)` ² |
| design | `design-review` | `Agent(subagent_type: 'design-reviewer')` ★ | `Skill('design-review', mode: fix)` |
| docs | `docs-review` | `Skill('docs-review', mode: audit)` | `Agent(subagent_type: 'docs-reviewer')` ★ |
| agent | `agent-review` | `Skill('agent-review', mode: audit)` | `Skill('agent-review', mode: fix)` ³ |

★ = agent-backed for that mode: dispatched via `Agent()` rather than inline `Skill()` because the mode needs tools the inline subagent doesn't have (browser for design audit; two-phase write+accuracy for docs fix). See `omnibus.yml` `leaves.<name>.agent_backed`.

¹ `code-review` walks both `src/rules/code/RULES.md` AND `src/rules/security/RULES.md`. Security findings are tagged (`security`, `injection`, `auth`, `secret`, `rce`, `xss`, `crypto`, `idor`, `ssrf`, `xxe`) and carry framework mappings (OWASP/CWE/NIST/ASVS/MITRE-ATT&CK). The user can scope to security alone via `/audit security` or `/fix security` — the omnibus dispatches `code-review` with a tag filter.

² Security-tagged findings require **per-finding** approval per `omnibus.yml by_tag` policy. No "approve all" path for any security tag. Non-security `code-review` findings use the default `single`-approval policy.

³ `agent-review` covers four sub-surfaces in one pass: `config` (CLAUDE.md, settings.json), `hooks` (`src/core/hooks/*.ts`), `skills` (`src/skills/*/SKILL.md`, `skill-rules.json`), and `personas` (`src/agents/*.md`). Findings tagged with `properties.sub_surface`. Config structural fixes delegate to `agnix --fix-safe`.

All review leaves emit SARIF natively per `src/skills/_shared/finding.md`. The `author` verb (`skill-creator` for new skills; `docs-review --mode enforce` for new docs) is invoked directly per artifact creation rather than orchestrated through the matrix.

## Phase 1: Fan out (parallel)

For each requested domain, invoke its `<domain>-review` leaf in parallel. Pass:

- `mode` — `audit` for the `/audit` verb (always); `audit` for the audit pass of the `/fix` verb (fix mode applies after approval in Phase 6)
- `scope` — resolved per `defaults.scope` and CLI overrides
- `reference` — if the user named one
- `threshold` — provisional only; the validation pass refines

**Standard leaves**: call `Skill('<domain>-review')` with mode argument.

**Agent-backed leaves**: call `Agent(subagent_type: "<agent-name>", ...)` instead of `Skill()`. Agent-backed leaves run in an isolated subagent context with full tool access. Per the registry table above:

- `design` audit mode → `Agent(subagent_type: "design-reviewer")` — needs browser/screenshot access for qualitative visual checks (RULES.md qualitative dimensions — hierarchy, motion, alignment — require `bun run ui:smoke` and visual rendering).

Each leaf returns a SARIF v2.1.0 run plus a prose phased summary. Capture both; merge the SARIF, keep the prose for context.

## Phase 1.5: Cross-domain consistency pass

Runs after all leaf audits return (Phase 1) and before validation (Phase 2). Always on when two or more domains are in scope; skipped for single-domain runs and when `--no-cross-domain` is passed.

Since the `agent-review` leaf now covers config + hooks + skills + personas internally, intra-`agent` drift (e.g. persona referencing a renamed skill, hook writer→consumer pairs) is a first-class finding emitted by the leaf itself. Phase 1.5 still runs for drift that crosses outside the `agent` domain (e.g. a code module's API signature consumed by a hook).

**Build the dispatch graph** (static analysis, no new Skill() calls):

1. Parse every agent file in scope → extract skill references (`subagent_type: "<name>"` literals, `/<name>` slash-commands, prose "dispatches to X skill")
2. Parse every hook file in scope → extract writer-reader pairs
3. Read `skill-rules.json` + `omnibus.yml` → build the full routing map

**Check the graph against scope changes:**

- For each **(agent → skill)** edge where the skill was in the audit scope or has git commits in the diff:
  - Emit `cross-domain-drift` on the agent file: "Skill `<name>` changed in scope; verify agent's dispatch description is still current"
  - Severity: `suggestion`; confidence 65 (validation pass refines)

- For each **(agent → skill)** edge where the skill file no longer exists:
  - Emit `dead-reference` on the agent file: "Agent dispatches to skill `<name>` which no longer exists in `src/skills/`"
  - Severity: `important`; confidence 95

- For each **(hook-writer → file → consumer)** pair where the writer was in the audit scope and the consumer is in another domain:
  - Emit `cross-domain-drift` on the consumer: "Hook `<writer-name>` output format may have changed; verify schema assumptions"
  - Severity: `suggestion`; confidence 60

**Merge** all Phase 1.5 findings into the main SARIF log before Phase 2. Validation applies to them the same as leaf findings. Tag all Phase 1.5 findings with `"source": "cross-domain"` in `properties` to distinguish them in the report.

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

When multiple leaves flag the same location with different rules (e.g. `code-review` flagging a hardcoded secret under both its code-quality rule family and its security rule family — both fire on `src/rules/code/RULES.md` and `src/rules/security/RULES.md`), keep both — they cite different rules and inform different fix paths.

## Phase 4: Report

Group findings by `properties.severity` first, then by `domain`, then by originating skill.

```
# Omnibus <verb> — <scope>

## Summary
N blocking · N important · N nit · N suggestion · N learning · N praise
Domains run: <list>   Domains skipped: <list with reasons>

## blocking
[code-review] src/research/src/providers/websearch.ts:209 — code/RULES.md#H.3 — confidence 88
  Catch returns '' on any error; failure mode invisible. Fix: log + tagged-result type.
  [tag: silent-fail] [approval: single]

## important
...

## praise
[code-review] src/research/src/providers/websearch.ts:106 — code/RULES.md#H.3 — confidence 95
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

Group approved findings by `domain`. For each domain with approved findings, **re-invoke the same review leaf with `mode: fix`** and the SARIF subset:

1. **Standard domains**: call `Skill('<domain>-review', mode: fix, findings: <sarif-subset>)`.
2. **Agent-backed fix domains**: call `Agent(subagent_type: "<agent-name>")` per `omnibus.yml leaves.<name>.agent_backed.fix`. Current agent-backed fix mode:
   - `docs` → `Agent(subagent_type: "docs-reviewer")` — docs-reviewer's two-phase workflow (Phase 1: write/update from source, Phase 2: accuracy + c7score) is more thorough than the inline fix-mode pass for correcting drift findings.
3. Wait for the leaf to return with edits applied + `gate("<domain>")` verification.
4. If the gate failed, stop. Surface the failure as a new finding (typically `severity: blocking`, `tag: regression`).

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
- Phase 1.5 cross-domain graph is static analysis only (git log + grep). No graph-index for deep semantic cross-file checks (Greptile v3 pattern) — that's post-v1 work.
- Approval gates use AskUserQuestion or simple chat prompts; no UI surface yet.

## Guardrails

- **R1: Only this skill calls `Skill()`.** Leaves never chain. If a leaf appears to need to invoke another leaf, surface it as a finding with a routing tag and let the omnibus dispatch.
- **Read-only by default.** Fix dispatch requires explicit user approval, every time.
- **No silent skips.** Every registry entry either runs or is reported as skipped with a reason.
- **Per-domain gates are non-negotiable.** No phase advances until all touched-domain gates are green.
- **Fix dispatch requires explicit user approval.** A direct "fix security issues" instruction from the user satisfies this — no additional per-finding gate is applied (except where `approval: per-finding` is configured).
- **The validation pass is the second line; the leaf's negative-filter is the first.** Both must run.

## Cross-references

- Per-project config: `omnibus.yml` (defaults, active leaves, approval policy)
- Finding contract: `src/skills/_shared/finding.md`
- Verification gates: `VERIFICATION.md`
- Architecture: `docs/plans/skill-architecture.md`
- Review leaves: `src/skills/{code,design,docs,agent}-review/SKILL.md`
- Domain rules: `src/rules/{code,design,docs,agent}/RULES.md`, plus `src/rules/security/RULES.md` (walked by `code-review`)
