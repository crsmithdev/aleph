---
name: code-review
description: 'Review code in scope — audit findings (default) or apply approved fixes (mode fix). Walks TypeScript/JavaScript under src/, evaluates rules in src/rules/code/RULES.md, emits SARIF v2.1.0 findings per src/skills/_shared/finding.md, and in fix mode applies each approved finding properties.fix and verifies with gate("code"). Fix shapes include slop removal (AI-generated comments, defensive code, backwards-compat shims, scope creep, impossible-case errors), pattern propagation from a reference file to peers, drift consolidation onto a canonical helper, and structural restructure. Triggers on "/audit code", "/fix code", "/code-review", "review the diff", "audit my code", "audit the code", "fix the findings", "apply the audit fixes", "simplify before commit", "deslop", "clean up code", "remove boilerplate", "align the routes", "match this handler", "make the providers consistent", "consolidate", "deduplicate", "/code-conform", or when the omnibus dispatches the audit or fix verb to the code domain.'
verb: review
domain: code
modes: [audit, fix]
metadata:
  argument-hint: <scope-or-module> [--mode audit|fix]
---

# Code Review

Single leaf for the code review surface. The orchestrator dispatches in `mode: audit` for the `/audit` verb (report only) and `mode: fix` for the `/fix` verb (apply approved findings).

Pure leaf: no `Skill()` calls. The omnibus chains audit → approval → fix.

## Modes

| Mode | Behavior |
|---|---|
| `audit` (default) | Walk scope → evaluate rules → emit SARIF + phased prose. No writes. |
| `fix` | Resolve findings (inline audit if none provided) → wait for approval → apply each approved finding's `properties.fix` → run `gate("code")` → return updated SARIF with `properties.applied: true` on resolved findings. |

## When to use

- User asks to review/audit the current branch or a module (`mode: audit`).
- User invokes `/code-review`, `/audit code`, or `/fix code`.
- The omnibus dispatches the `audit` or `fix` verb to the `code` domain.
- After audit findings have been approved and need to be applied (`mode: fix`).
- User invokes `/code-review --mode fix` directly with a reference — runs an inline audit pass against that reference, then asks for approval before applying.

## When NOT to use

- Visual/layout review or fixes → `design-review`.
- Documentation review or fixes → `docs-review`.
- Hook, agent, or skill review → those domain leaves.
- Security review → `security-review` (separate domain; per-finding approval is mandatory there).
- Net-new features (fix mode applies *findings*, not roadmap items).
- Fix mode without approved findings — run audit mode first.

## Inputs

1. **Mode** — `audit` (default) or `fix`.
2. **Scope** (default: smart — see below) — `--diff` against `origin/main`, `--module <path>`, `--since <git-ref>`, or `--all`. In fix mode the scope is inherited from the audit findings and never expands beyond them.
3. **Findings** (fix mode, preferred) — SARIF v2.1.0 from a prior audit pass, either passed inline or read from disk. If absent, fix mode runs an inline audit first and gates on user approval.
4. **Reference** (optional) — a file/section/symbol; when provided in audit mode, enables drift checks (RULES §D); when provided in fix mode (with no findings), seeds the inline audit pass.
5. **Threshold** (optional, audit mode) — confidence floor 0-100; default 80 per `omnibus.yml`.
6. **Phase filter** (optional, fix mode) — `--phase blocking,important` to limit which severity tiers get applied.

## Process

The audit pass (steps 1-5) is shared. In `mode: fix`, steps 6-10 add planning, approval, application, and verification.

### 1. Resolve scope (audit pass)

```bash
# --diff (against origin/main, the conventional default for feature branches)
git diff --name-only origin/main...HEAD -- 'src/**/*.ts' '*.ts' | grep -v '^src/ui/'

# --since <ref> (everything changed between <ref> and HEAD)
git diff --name-only <ref>...HEAD -- 'src/**/*.ts' '*.ts' | grep -v '^src/ui/'

# --module <path>   (path can be a directory, glob, or single file)
find <path> -name '*.ts' -not -path '*/node_modules/*'

# --all
find src -name '*.ts' -not -path '*/node_modules/*' -not -path 'src/ui/*'
```

**Smart default:**

1. Try `--diff` first.
2. If `--diff` returns empty (typical right after a push to main, or on a clean main checkout):
   - **Do not silently audit nothing.** Stop and surface this message: *"No files in scope: `origin/main...HEAD` is empty. Try `/audit code --module <path>`, `/audit code --since HEAD~5`, or `/audit code --all`."*
   - The audit ends here unless the user re-invokes with an explicit scope.

Exclude `src/ui/` (visual concerns → `design-review`), `*.generated.ts`, `.worktrees/`, and anything matched by `omnibus.yml` `leaves.code-review.exclude`.

### 2. Walk the rules

For each in-scope file, evaluate every section in `src/rules/code/RULES.md` (A through H). For each rule, the `Detect:` line in RULES.md describes the signal. Concrete examples:

- **A.1 (no `any`):** grep `as any` in each file; exclude `JSON.parse` results and third-party-boundary casts (mark those with a same-line comment).
- **A.4 (no bare `@ts-ignore`):** grep for `@ts-ignore` and `@ts-expect-error`; flag if the next 80 chars on the same line contain no `//` justification.
- **B.1 (defensive code):** find try/catch blocks whose body has no rethrow/log/branching — the catch swallows the error.
- **B.2 (comments restating code):** for each `//` comment, compare its tokens to the next non-blank line's identifiers; flag if ≥60% overlap.
- **C.1 (inline reimplementation):** for each function in scope, grep `src/` for distinctive substrings of its body; flag matches outside that file.
- **F.3 (hooks in `.claude/`):** check `.claude/settings.json` for a `hooks` array — single grep, single finding if present.
- **H.1 (hooks fail loudly):** for each file under `src/core/hooks/`, confirm `JSON.parse(await Bun.stdin.text())` is inside a try/catch and the catch exits non-zero.

When a rule's Detect signal doesn't apply to the current scope (e.g., G.1 N+1 queries on a docs-only diff), skip silently — no "no findings" noise per rule.

### 3. Apply negative-filter list

For every candidate finding, check the negative-filter list (in `src/rules/code/RULES.md` and mirrored in `src/skills/_shared/finding.md`):

- Style/quality concerns not in RULES.md → drop
- Pre-existing issues outside scope → record under "Pre-existing Issues" run, not in primary findings
- Pedantic nitpicks → drop
- Issues a linter would catch → cite `agnix/<rule>` or `eslint/<rule>`, mark `severity: nit`
- Lint-ignored lines → drop

The validation pass (performed by the omnibus) is the second line of defense; this skill is the first.

### 4. Emit SARIF

Output a single SARIF v2.1.0 run with `tool.driver.name = "code-review"`. Per `src/skills/_shared/finding.md`, each `result` has:

```json
{
  "ruleId": "code/RULES.md#<section-anchor>",
  "level": "error" | "warning" | "note" | "none",
  "message": { "text": "<one-line description>" },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "..." }, "region": { "startLine": N, "endLine": N } } }],
  "properties": {
    "confidence": <0-100, set provisionally; validation pass refines>,
    "severity": "blocking" | "important" | "nit" | "suggestion" | "learning" | "praise",
    "fix": "<concrete proposed change>",
    "tag": "<from RULES.md Tag: line>",
    "scope": "diff" | "module" | "all",
    "applied": <true only in fix mode after the edit lands>
  }
}
```

When proposing a `praise` finding, the bar is concrete: **the code solves a typical anti-pattern with a clean solution worth propagating to peers.** Praise must be (a) tied to a specific RULES.md rule the code exemplifies the opposite of, and (b) actionable — every praise finding's `fix` field carries a one-line "use this as a reference for: <pattern>" so fix mode (in propagation mode) or `code-conform` can use it as the anchor for aligning peers.

Examples of qualifying praise:
- A try/catch that logs + rethrows with context (counter-example for H.2 / H.3 violations elsewhere)
- A circuit breaker that captures and exposes failure mode instead of swallowing it
- A function that absorbs complexity behind a clean interface (counter-example for B.1 over-engineering)
- A test that exercises the negative path with real malformed input

If no code in the scope qualifies, **omit praise** — don't manufacture it. Tokenistic praise ("this file uses TypeScript") degrades the signal.

### 5. Emit a phased prose summary

After the SARIF block, output a phased report for human readers (the omnibus reads the SARIF; humans read the prose):

```
# Code Review — <scope> — mode: audit

## blocking (N)
- <file:line> — <rule> — <one-line> (confidence X)

## important (N)
- ...

## nit (N)
- ...

## suggestion / learning / praise (N each)
- ...

## Pre-existing issues (out of scope, M)
- ...
```

**In `mode: audit`, stop here.** Return the SARIF as the structured result; the omnibus assembles the cross-domain phased report.

### 6. Resolve findings (fix mode)

If findings were passed in (the omnibus path), parse the SARIF. Otherwise, the inline audit pass (steps 1-5) just produced them — gate on user approval before continuing. Filter by `--phase` if provided.

### 7. Group by fix shape

Each finding's `properties.tag` routes it to a fix shape:

| Tag | Fix shape | What it does |
|---|---|---|
| `slop` | Slop removal | Delete defensive code, redundant comments, scope creep, backwards-compat shims (RULES §B) |
| `drift` (with reference) | Propagation | Apply the reference's pattern to the peer file along chosen dimensions |
| `drift` (without reference) | Consolidation | Route the duplicate site through the canonical helper; delete inline reimplementations |
| `silent-fail` | Loud failures | Add try/catch with explicit exit codes; rewrite swallowing catches to log+rethrow |
| `placement` | Restructure | `git mv` files to the correct module; update imports |
| `perf` | Performance fix | Replace N+1 with batched call; nested loops with Map/Set; add memoization |
| `leak` | Cleanup wiring | Add the paired removeListener/unsubscribe in the same scope |
| `test-coverage` / `test-quality` | Test addition | Write a failing test that exercises the missing path |
| `style` / `correctness` | Inline edit | Apply the literal fix from `properties.fix` |
| `double-fire` | Settings cleanup | Remove duplicate registration; verify only one path remains |

For findings without a clean tag mapping, treat `properties.fix` as the literal change and apply it minimally.

### 8. Plan the edits

For each finding, compute the minimal `Edit` operation. Group edits by file so the patch lands atomically per file.

**Hard rules:**

- **Never rewrite a file wholesale** unless the finding explicitly authorizes it and the user has approved that specific finding.
- **Never enforce a dimension not in the finding.** A `drift` finding for "header layout" doesn't license editing button colors.
- **Removed code goes completely.** Per Commandment 7: no `// removed` markers, no orphaned imports, no commented-out blocks "for reference."
- **No scope creep.** If a fix surfaces an adjacent issue, log it as a new finding for the next audit — don't fix it in this pass.

Before applying, output the planned edits as a unified diff or per-file edit list:

```
Plan: 4 findings → 3 file edits across 2 files

src/research/src/providers/websearch.ts:
  - L19-21: add `console.warn('tavily failed: ' + err.message)` before fall-through (H.3)
  - L64: log `res.status` + body snippet before `return []` (H.3)
  - L209-211: replace `catch { return ''; }` with logged + tagged result (H.3)

src/research/src/providers/router.ts:
  - L42-45: remove unused `_taskType` parameter and inline `this.modelConfig.model` at the one caller (B.3)

...
```

For an omnibus-dispatched run with prior approval (the user already approved the audit findings), proceed directly to step 9. For direct invocation without prior approval, stop here and wait for the user.

### 9. Apply edits

Apply edits in atomic groups (one Edit operation per logical change). Order:

1. **Same-file edits in reverse line order** (so earlier-line edits don't shift later-line references).
2. **Cross-file edits in dependency order** (move first, then update importers).
3. **Restructure operations last** (`git mv`, then import path updates).

After each file is fully edited, optionally re-check the file against the relevant RULES.md sections to confirm the fix resolved the finding (and didn't introduce a new one). Mark applied findings with `properties.applied: true` in the returned SARIF.

### 10. Verify

Run `gate("code")` from `VERIFICATION.md`. The skill MUST NOT claim done until the gate is green.

If `gate("code")` fails:

- Identify which fix likely broke the test.
- Either revert that fix and surface a new finding, OR adjust the fix and re-run the gate.
- Never silence a failing test to make the gate pass.

For changes that touch `src/ui/**` or shared types, also call `gate("design")`.

Then summarize in one paragraph: which findings were resolved, which files were touched, which findings were skipped and why, and what (if anything) the user should still review by eye.

## Fix-shape detail: slop removal

For `tag: slop` findings, with `--diff origin/main...HEAD` as the canonical scope. Triggered by phrases like "deslop", "clean up before commit", "simplify this", "remove boilerplate".

**Slop patterns** (audit-mode SARIF should already have flagged these — fix mode applies the removal):

- **Defensive code (B.1):** Remove try/catch with no rethrow/log/branching. If the catch was suppressing a real error path, surface it as a new finding instead of silently removing.
- **Restating comments (B.2):** Delete the comment, not the code below it. Comments that only restate the next line of code add nothing.
- **Backwards-compat shims (B.3):** Remove the shim, the export, and any orphaned imports. Grep first to confirm zero consumers. Renamed `_vars`, re-exports, `// removed`-style comments all qualify.
- **Scope creep (B.4):** Revert cosmetic-only changes to unchanged code. Match the file's pre-change state for those lines. Includes added docstrings, type annotations, or refactors on code that wasn't touched by the user's request.
- **Impossible-case errors (B.5):** Remove the `throw`. If the case is reachable via untrusted input, leave it and reclassify the finding.
- **`any` casts (B.6):** Casts to `any` introduced only to bypass type issues. Restore the proper type or surface as a real finding if the type system was genuinely wrong.

**Style fixes that ride along** (apply if the diff includes them):

- Prefer `function` keyword over arrow functions for top-level declarations.
- Explicit return type annotations on exported functions.
- ES modules with proper import sorting and extensions.
- No nested ternaries — convert to `switch` or `if/else` chains.
- Three similar lines beat a premature abstraction.

**Verification:** re-run `git diff origin/main...HEAD` and confirm only slop was removed (no functional changes). Then `gate("code")`.

## Fix-shape detail: consolidation (drift without reference)

For `tag: drift` findings where the canonical helper exists (named in `relatedLocations`). Triggered by "consolidate", "deduplicate", "single source of truth", "make X the canonical".

1. Read both the duplicate site and the canonical helper.
2. Replace the inline implementation with an import + call.
3. Delete the orphan inline implementation (don't leave it commented). If the canonical helper needs a small surface tweak to absorb peer use cases, edit it once, then route everyone through it.
4. Check for other callers in the same family — if you find them, surface them as new findings rather than expanding scope.
5. **Commandment 7:** when you route a peer through a canonical helper, the peer's now-unused inline implementation, helper, or import must go.

## Fix-shape detail: propagation (drift with reference)

Reference-based: user points at one file/function as the canonical pattern; peers get aligned. Triggered by "align the routes", "match this handler", "make the providers consistent", "apply this pattern", or `/code-review --reference <path>`.

**Five pattern dimensions** to compare on:

- **Structural** — file/section ordering, exports, function signatures
- **Compositional** — which helpers/wrappers/classes are used
- **Behavioral** — error handling, validation, response shape, retries, fallbacks
- **Surface** — imports, type names, naming conventions
- **Duplication of behavior** — when the reference IS a helper that should exist, peers are sites re-solving the same problem inline (fix shape becomes consolidation, see below)

If the user gave notes ("only error wrapping"), narrow to that. Otherwise default to *everything that looks like an intentional pattern* — skip incidental differences (variable names, business logic specific to the file's domain).

**Process:**

1. **Resolve the reference.** Read the file/section/symbol. If ambiguous, ask before proceeding.
2. **Find peers** by, in order: filename pattern (`*.handler.ts`, `providers/*.ts`), directory siblings, files importing the same key dependencies, files touched in the current session. For the duplication-axis case, also grep for the inline shape across `src/`.
3. **Present the peer list first.** "Found 7 peers: A, B, C, D, E, F, G. Trim or proceed?" Never apply edits before the user can remove false positives.
4. **Reference-as-outlier check.** If the reference differs from a majority of peers, surface: "Note: 5 of 7 peers don't follow the reference's pattern. Is the reference the new canonical, or did I pick the wrong anchor?" Let the user confirm or flip the anchor.
5. **Compute minimal Edit** on each peer. Preserve domain logic, business-specific behavior, and incidental differences. Never rewrite wholesale unless the peer is severely degraded.
6. **Surface intentional divergence.** If a peer has `// conform:exempt` or an obvious comment indicating intentional difference, skip it and note in the report.
7. **One reference, one pass.** Don't enforce multiple unrelated patterns in a single invocation — ask the user to run again with a different reference.

## Fix-shape detail: restructure

For `tag: placement` findings:

1. Document every importer of the file being moved (`grep -rn "from '<old-path>'" src/`).
2. `git mv` the file.
3. Update every importer in the same commit.
4. Run `gate("code")` immediately to catch any missed import.

## Scope discipline

- **Audit mode is read-only.** No `Edit`, `Write`, or `Bash` calls that mutate state. Bash is used for `git diff`, `grep`, `find` only.
- **No `Skill()` calls.** The omnibus chains; we audit or apply.
- **Verification gate.** `gate("code")` runs only when fix mode finishes applying changes; audit mode is non-mutating.

## Output template

### Audit mode

The SARIF JSON block goes first (the omnibus reads it). The prose phased report follows (humans read it).

```
[sarif]
{ ... SARIF v2.1.0, tool.driver.name = "code-review" ... }
[/sarif]

# Code Review — <scope> — mode: audit
<phased prose>
```

### Fix mode

Plan output (before apply), per-edit confirmation, the gate result, then the updated SARIF (with `properties.applied` flags) and summary:

```
[plan]
... edit list ...
[/plan]

[applying]
... per-edit lines ...
[/applying]

[verify]
scope:      <files edited>
method:     gate("code")
assertions: full suite passes; no new failures introduced
[/verify]

[sarif]
{ ... updated SARIF with properties.applied: true on resolved findings ... }
[/sarif]

# Summary
- <N> findings resolved
- <M> files edited
- <K> findings skipped (with reasons)
- Manual review suggested: <files>
```

## Guardrails

- **Confidence is provisional.** The audit emits its own confidence guess; the omnibus's validation pass refines it. Don't pretend the confidence is final.
- **Cite rules precisely.** Every finding includes a `code/RULES.md#<anchor>` ruleId. No bare prose accusations.
- **Don't double-report.** If agnix or eslint would catch it, cite them (`agnix/<rule>`) — don't issue a separate code-review finding.
- **Praise is intentional.** Most audits will have at least one `praise` finding. Make it specific (cite the file/lines), not generic.
- **Negative-filter is non-negotiable.** When in doubt about whether to flag, don't.
- **Verification is non-negotiable (fix mode).** Never claim done without a green `gate("code")` result in the turn's tool output.
- **Approved findings only (fix mode).** No fix without an approved finding (either inline-audit + user approval, or omnibus-passed approved SARIF).
- **No scope creep (fix mode).** Adjacent issues become new findings, not new edits.
- **Minimal edits (fix mode).** Smallest change that resolves the finding. No "while I'm here" cleanup.

## Cross-references

- Rule source: `src/rules/code/RULES.md`
- Finding contract: `src/skills/_shared/finding.md` (SARIF schema + Construct extensions)
- Orchestrator: `src/skills/omnibus/SKILL.md`
- Verification gate table: `VERIFICATION.md`
- Sibling domain leaves: `design-review`, `docs-review`, `security-review`, `agent-review`
- Pattern-propagation companion: `src/skills/code-conform/SKILL.md`
