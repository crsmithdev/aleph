---
name: code-fix
description: Apply fixes for code-audit findings — slop removal, consolidation onto a canonical helper, drift conformance to a reference, structural refactor. Takes SARIF findings as input or runs an inline code-audit pass first. Triggers on "fix the findings", "/code-fix", "apply the audit fixes", or when the omnibus dispatches the fix verb to the code domain.
verb: fix
domain: code
modes: [fix]
---

# Code Fix

Applies edits derived from `code-audit` findings. Each finding's `properties.fix` describes the change; this skill executes it minimally and verifies with `gate("code")`.

Pure leaf: no `Skill()` calls. The omnibus chains audit → approval → fix.

## When to use

- After `code-audit` produced findings and the user (or omnibus) approved them.
- User invokes `/code-fix` against a saved SARIF report, or `/fix code` via the omnibus.
- User invokes `/code-fix` directly with a reference — runs an inline audit pass against that reference, then asks for approval.

## When NOT to use

- Visual/layout fixes → `design-fix`.
- Documentation fixes → `docs-fix`.
- Security findings → `security-fix` (per-finding approval is mandatory).
- Net-new features (this skill applies *findings*, not roadmap items).
- When findings haven't been approved yet — run `code-audit` first.

## Inputs

1. **Findings** (preferred) — SARIF v2.1.0 from `code-audit`, either passed inline or read from disk.
2. **Reference** (optional, only when no findings provided) — file/section/symbol; runs an inline audit pass first.
3. **Scope** — inherited from the audit findings; never expands beyond them.
4. **Phase filter** (optional) — `--phase blocking,important` to limit which severity tiers get applied.

## Process

### 1. Resolve findings

If findings provided (the omnibus path), parse the SARIF. Otherwise run `code-audit` inline against the scope (which may include the optional reference) and gate on user approval before continuing.

### 2. Group by fix shape

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

### 3. Plan the edits

For each finding, compute the minimal `Edit` operation. Group edits by file so the patch lands atomically per file.

**Hard rules:**

- **Never rewrite a file wholesale** unless the finding explicitly authorizes it and the user has approved that specific finding.
- **Never enforce a dimension not in the finding.** A `drift` finding for "header layout" doesn't license editing button colors.
- **Removed code goes completely.** Per Commandment 7: no `// removed` markers, no orphaned imports, no commented-out blocks "for reference."
- **No scope creep.** If a fix surfaces an adjacent issue, log it as a new finding for the next audit — don't fix it in this pass.

### 4. Show the plan

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

For an `omnibus`-dispatched run with prior approval (the user already approved the audit findings), proceed directly to step 5. For direct invocation without prior approval, stop here and wait for the user.

### 5. Apply edits

Apply edits in atomic groups (one Edit operation per logical change). Order:

1. **Same-file edits in reverse line order** (so earlier-line edits don't shift later-line references).
2. **Cross-file edits in dependency order** (move first, then update importers).
3. **Restructure operations last** (`git mv`, then import path updates).

After each file is fully edited, optionally re-check the file against the relevant RULES.md sections to confirm the fix resolved the finding (and didn't introduce a new one).

### 6. Verify

Run `gate("code")` from `VERIFICATION.md`. For Construct that resolves to `bun test.ts`. The skill MUST NOT claim done until the gate is green.

If `gate("code")` fails:

- Identify which fix likely broke the test.
- Either revert that fix and surface a new finding, OR adjust the fix and re-run the gate.
- Never silence a failing test to make the gate pass.

For changes that touch `src/ui/**` or shared types, also call `gate("design")` (resolves to `bun run ui:smoke`).

### 7. Summarize

One paragraph: which findings were resolved, which files were touched, which findings were skipped and why, and what (if anything) the user should still review by eye.

## Fix-shape detail: slop removal

For `tag: slop` findings:

- **Defensive code (B.1):** Remove try/catch with no rethrow/log/branching. If the catch was suppressing a real error path, surface it as a new finding instead of silently removing.
- **Restating comments (B.2):** Delete the comment, not the code below it.
- **Backwards-compat shims (B.3):** Remove the shim, the export, and any orphaned imports. Grep first to confirm zero consumers.
- **Scope creep (B.4):** Revert cosmetic-only changes to unchanged code. Match the file's pre-change state for those lines.
- **Impossible-case errors (B.5):** Remove the `throw`. If the case is reachable via untrusted input, leave it and reclassify the finding.

## Fix-shape detail: consolidation (drift without reference)

For `tag: drift` findings where the canonical helper exists (named in `relatedLocations`):

1. Read both the duplicate site and the canonical helper.
2. Replace the inline implementation with an import + call.
3. Delete the orphan inline implementation (don't leave it commented).
4. Check for other callers in the same family — if you find them, surface them as new findings rather than expanding scope.

## Fix-shape detail: propagation (drift with reference)

For `tag: drift` findings where the reference is given:

1. Read the reference along the chosen dimensions only (structural / compositional / behavioral / surface).
2. Compute the minimal Edit on the peer to match.
3. Preserve domain logic, business-specific behavior, and incidental differences.
4. Never rewrite the peer wholesale.

## Fix-shape detail: restructure

For `tag: placement` findings:

1. Document every importer of the file being moved (`grep -rn "from '<old-path>'" src/`).
2. `git mv` the file.
3. Update every importer in the same commit.
4. Run `gate("code")` immediately to catch any missed import.

## Output

Plan output (before apply) followed by per-edit confirmation, then the gate result:

```
[plan]
... edit list ...
[/plan]

[applying]
... per-edit lines ...
[/applying]

[verify]
scope:      <files edited>
method:     bun test.ts (gate("code"))
assertions: full suite passes; no new failures introduced
[/verify]

# Summary
- <N> findings resolved
- <M> files edited
- <K> findings skipped (with reasons)
- Manual review suggested: <files>
```

## Guardrails

- **Verification is non-negotiable.** Never claim done without a green `gate("code")` result in the turn's tool output.
- **Approved findings only.** No fix without an approved finding (either inline-audit + user approval, or omnibus-passed approved SARIF).
- **No scope creep.** Adjacent issues become new findings, not new edits.
- **Minimal edits.** Smallest change that resolves the finding. No "while I'm here" cleanup.
- **No `Skill()` calls.** The omnibus dispatches; we apply.

## Cross-references

- Rule source: `src/rules/code/RULES.md`
- Finding contract: `src/skills/_shared/finding.md`
- Audit counterpart: `src/skills/code-audit/SKILL.md`
- Orchestrator: `src/skills/omnibus/SKILL.md`
- Verification gate table: `VERIFICATION.md`
