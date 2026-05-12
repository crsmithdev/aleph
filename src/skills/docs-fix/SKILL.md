---
name: docs-fix
description: >
  Apply fixes for docs-audit findings — peer-drift propagation across doc
  families, c7score optimization (LLM-discoverability improvements), structural
  fixes (drift, broken cross-references, stale stub markers), polish (voice,
  AI-tells, density). Takes SARIF findings from `docs-audit` as input, routed
  by `properties.tag` to the appropriate fix shape. Triggers on "fix the docs
  findings", "remediate docs drift", "/docs-fix", "/fix docs", or when the
  omnibus dispatches the fix verb to the docs domain after approval.
verb: fix
domain: docs
modes: [fix]
---

# Docs Fix

Applies edits derived from `docs-audit` findings. Each finding's `properties.tag` routes it to a fix shape; this skill executes the change minimally and verifies the doc still parses, references resolve, and behavior claims still match code.

Pure leaf: no `Skill()` calls. The omnibus chains audit → approval → fix.

## When to use

- After `docs-audit` produced findings and the user approved them.
- User invokes `/docs-fix` against a saved SARIF report, or `/fix docs` via the omnibus.
- User invokes `/docs-fix <reference>` directly — runs an inline audit pass first, then asks for approval before applying.

## When NOT to use

- Code fixes → `code-fix`.
- Visual / layout fixes → `design-fix`.
- Security findings → `security-fix`.
- Net-new documentation authoring → `docs-author` / `docs-author-v2`.
- When findings haven't been approved yet — run `docs-audit` first.

## Inputs

1. **Findings** (preferred) — SARIF v2.1.0 from `docs-audit`, passed inline (omnibus path) or read from disk.
2. **Reference** (optional, only when no findings provided) — a canonical doc; runs an inline audit pass first.
3. **Scope** — inherited from findings; never expands beyond them.
4. **Phase filter** (optional) — `--phase critical,refinement` to limit which severity tiers get applied.

## Process

### 1. Resolve findings

If findings provided (omnibus path), parse the SARIF and group by `properties.tag`. Otherwise run `docs-audit` inline against the scope and gate on user approval.

### 2. Group by fix shape

Each finding's `properties.tag` routes to a fix shape:

| Tag | Fix shape | What it does |
|---|---|---|
| `drift` | Doc-vs-code correction | Rewrite the doc claim to match the code's current behavior, or surface the discrepancy as a question (when intent is ambiguous) |
| `peer-drift` | Propagation | Apply the reference doc's structure (heading shape, section order, frontmatter) to the drifted peer — preserve domain content |
| `c7score` | LLM-discoverability fix | Apply the optimization called for in `src/skills/docs-optimize/REFERENCE.md`: add question-answering snippets, expand abbreviated examples to self-contained form, fix metadata snippet pollution |
| `broken-ref` | Cross-reference repair | Update the path / anchor; if the target was removed, either restore or remove the reference |
| `stale-stub` | TODO removal | Either fill the stub with real content (when the user gives one) or remove the section entirely |
| `voice` | Tone fix | Apply the voice rules from `src/rules/docs/RULES.md` §A: remove AI tells, filler ("just", "really", "very"), passive voice |
| `density` | Tighten / restructure | Move the conclusion to paragraph 1 (lead-buried answer fix), break long sentences, remove "in this section we will…" openers |
| `formatting` | Surface fix | Add code-block language tags, fix heading depth, replace emojis, convert tables↔paragraphs per RULES.md §B |
| `structure` | TOC / metadata | Add missing TOC for docs > 100 lines; add last-updated; add doc-type-specific required sections |

For findings without a clean tag mapping, treat `properties.fix` as the literal change and apply it minimally.

### 3. Plan the edits

Compute the minimal `Edit` per finding. Group edits by file.

**Hard rules:**

- **Never rewrite a doc wholesale** unless the finding explicitly authorizes it and the user approved that specific finding.
- **Never enforce a dimension not in the finding.** A `voice` finding doesn't license a structural reorganization.
- **Preserve domain content.** Peer-drift propagation copies structure, not specific content (file paths, command names, prose body).
- **Removed content goes completely.** Per Commandment 7: no `<!-- removed -->` markers, no orphaned anchors, no commented-out sections "for reference."
- **No scope creep.** Adjacent issues surface as new findings, not new edits.

### 4. Show the plan

Output the planned edits as a unified diff or per-file edit list. For omnibus-dispatched runs with prior approval, proceed to step 5. For direct invocation, stop and wait.

### 5. Apply edits

1. **Same-file edits in reverse line order** (so earlier-line edits don't shift later-line references).
2. **Cross-file edits last** (peer-drift propagation across many files; one canonical edit applied to multiple peers).
3. **Frontmatter changes first within a file**, then body, then trailing references.

After each file is edited, re-check the targeted RULES.md rule to confirm the finding resolved.

### 6. Verify

Run `gate("docs")` from `VERIFICATION.md`. For Construct today this is not yet implemented (`omnibus.yml` shows `docs: ""`); when absent, perform these checks inline:

- **Markdown parses** — every changed doc renders without warnings via the docs pipeline.
- **Cross-references resolve** — for each `[text](path)` and `@path` reference in the changed docs, confirm the target exists.
- **Frontmatter parses** — YAML frontmatter (where present) is valid.
- **`bun test.ts` green** — confirms no test that references a changed doc broke (e.g., skill-rules-driven tests).

If any check fails:

- Identify which fix likely caused the issue.
- Either revert that fix and surface a new finding, OR adjust the fix and re-run the checks.
- Never silence a check or remove a reference to "fix" the gate.

### 7. Summarize

One paragraph: which findings were resolved, which files were touched, which findings were skipped and why.

## Tag-specific detail

### Peer-drift propagation

For `tag: peer-drift` findings where `relatedLocations[0]` is the canonical reference:

1. Read the reference along the chosen dimension (structure / voice / frontmatter shape).
2. Compute the minimal Edit on the peer to match.
3. Preserve domain-specific prose, file paths, and example values.
4. Check for other peers in the same family — if they need the same fix, surface as new findings rather than expanding scope.

### c7score optimization

For `tag: c7score` findings:

1. Read the optimization detail in `properties.fix` — usually one of: add a question-answering snippet, expand an import-only fragment, mask metadata snippets, restructure a section to be self-contained.
2. Apply the change with the doc's existing voice / formatting conventions.
3. If the optimization requires significant rewriting, surface as a `severity: suggestion` finding for the user rather than auto-applying.

### Drift correction

For `tag: drift` findings (doc claim contradicts code):

1. Read the cited code lines.
2. Read the cited doc lines.
3. Determine which is correct (usually code wins; sometimes doc surfaces a bug in code).
4. If code wins: rewrite the doc to match.
5. If doc wins: surface a `code-audit` finding to fix the code (do not silently auto-edit the code from this skill).

## Output

```
[plan]
... edit list, grouped by file ...
[/plan]

[applying]
... per-edit lines ...
[/applying]

[verify]
scope:      <files edited>
method:     gate("docs") (markdown parse + cross-ref resolution + frontmatter parse + bun test.ts)
assertions: every changed doc parses; every cross-reference resolves; full test suite passes
[/verify]

# Summary
- <N> findings resolved
- <M> files edited
- <K> findings skipped (with reasons)
- Manual review suggested: <files>
```

## Guardrails

- **Verification is non-negotiable.** Never claim done without the four inline checks (parse + xref + frontmatter + bun test.ts) green in the turn's tool output.
- **Approved findings only.** No fix without an approved finding.
- **Preserve domain content.** Propagation copies structure; never the body.
- **No scope creep.** Adjacent issues are new findings, not new edits.
- **No `Skill()` calls.** The omnibus dispatches; we apply.

## Cross-references

- Rule source: `src/rules/docs/RULES.md`
- Finding contract: `src/skills/_shared/finding.md`
- Audit counterpart: `src/skills/docs-audit/SKILL.md`
- LLM-discoverability reference: `src/skills/docs-optimize/REFERENCE.md`
- Orchestrator: `src/skills/omnibus/SKILL.md`
- Verification gate table: `VERIFICATION.md`
