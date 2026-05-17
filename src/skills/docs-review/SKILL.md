---
name: docs-review
description: Review documentation — audit drift/accuracy (default), apply approved fixes (mode: fix), or auto-apply rules silently while writing markdown (mode: enforce). Fix mode is agent-backed via docs-reviewer (two-phase write + accuracy workflow). Evaluates rules in src/rules/docs/RULES.md. Triggers on /audit docs, /fix docs, /docs-review, "audit the docs", "review the documentation", "docs drift", "review the readme", "fix the documentation", "remediate docs drift", "align these docs", "sync docs to reference", and is self-invoked in enforce mode whenever the agent is writing or editing markdown.
verb: review
domain: docs
modes: [audit, fix, enforce]
agent_backed:
  fix: docs-reviewer
metadata:
  argument-hint: <scope-or-doc-path> [--mode audit|fix|enforce]
---

# Docs Review

Unified documentation skill. Three modes:

- `audit` — find violations, drift, peer-drift, c7score gaps (read-only)
- `fix` — apply approved findings (agent-backed via `docs-reviewer`)
- `enforce` — auto-apply rules silently while writing/editing markdown (no audit pass, no findings, no diff)

Canonical rules: `src/rules/docs/RULES.md`. Suggested-but-not-yet-enforced additions: `src/rules/docs/SUGGESTIONS.md`. Every audit finding cites a rule section + `file:line`.

## Modes

| Mode | Default? | Agent-backed? | Trigger | Purpose |
|---|---|---|---|---|
| `audit` | yes | no — inline | `/audit docs`, "audit the docs", or omnibus audit-verb dispatch | Walk docs, identify violations, doc-vs-code drift, peer-drift, c7score gaps. Emit phased plan + SARIF findings. **No writes.** |
| `fix` | no | yes — `docs-reviewer` | `/fix docs`, "fix the docs findings", or omnibus fix-verb dispatch after approval | Apply approved findings via docs-reviewer's two-phase workflow (Phase 1: write/update from source; Phase 2: accuracy + c7score). |
| `enforce` | no | no — inline | Self-invoked when the agent is writing or editing markdown content (README, AGENTS.md, SKILL.md, guides, API docs) | Apply every rule in `src/rules/docs/RULES.md` silently while producing markdown. No asking, no explaining, no before/after. |

Pure leaf: no `Skill()` calls. The omnibus chains audit → approval → fix. When `mode: fix` is selected, dispatch is via `Agent(subagent_type: "docs-reviewer")` — its two-phase write+accuracy workflow is more thorough than a bare edit pass for correcting drift findings.

## When to use

- `audit` — post-hoc review of existing docs against the rule set; surfacing drift, voice issues, c7score gaps, peer divergence
- `fix` — after an audit pass produced approved findings, or `/docs-review <ref> --mode fix` (runs inline audit first, gates on approval, then dispatches docs-reviewer)

## When NOT to use

- Net-new documentation authoring → `docs-author` (this skill covers post-hoc review and write-time enforcement; `docs-author` covers planning + drafting from scratch)
- Code fixes → `code-review --mode fix`
- Visual / layout fixes → `design-review --mode fix`
- Security findings → `security-review --mode fix`
- Agent-definition drift → `agent-review`

---

## Mode: audit

Post-hoc companion to `docs-author-v2`. Reads the same rule set; produces findings instead of suppressing them at write-time.

Walk the doc(s) in scope, check against every rule in `src/rules/docs/RULES.md`, run drift checks, and emit a phased plan. Do not write any fix without the user's explicit approval per finding.

### Process

#### 0. Establish scope

Identify exactly which docs are under audit:

```bash
# Single doc
git diff --name-only HEAD~1 -- '*.md'    # changed in last commit
# Doc family
ls src/skills/*/SKILL.md                  # all skill SKILL.md files
ls src/**/README.md                       # all module READMEs
```

Pre-existing issues outside the audit scope go in a "Pre-existing Issues" section — don't mix them with findings about the change.

#### 1. Voice & style check

Against `RULES.md` section A. Flag:
- AI-tell phrases ("Sure!", "That's a great question!", restating the question)
- Filler ("just", "really", "very", "basically")
- Passive voice in user-facing prose
- Sentences that could be removed without losing information

#### 2. Formatting check

Against `RULES.md` section B. Flag:
- Code blocks without language tags
- More than one H1 per file
- Heading depth > 3
- Emoji
- Tables that should be paragraphs (or vice versa)
- File references not using `path/to/file:line` format

#### 3. Density check

Against `RULES.md` section C. Flag:
- Lead-buried answers (the conclusion is in paragraph 4 instead of paragraph 1)
- "In this section we will…" / "It's worth noting…" openers
- Empty or stub sections ("this will be filled in")
- Long sentences that fit two short ones

#### 4. Structure & metadata check

Against `RULES.md` section D. Flag:
- Missing TOC on docs > ~100 lines
- Missing version / last-updated where relevant
- Doc-type-specific issues (API docs missing schemas; config docs missing defaults)

#### 5. Accuracy / drift check

Against `RULES.md` section E. **This is the highest-priority audit dimension** — flag as Critical:
- References to functions, files, or flags that don't exist
- Behavioral claims that contradict actual code
- Code examples that don't run
- Cross-references that 404
- Stale stub markers (TODO, FIXME, "Coming soon")

For repo-specific drift checks, use the truth-source table in `RULES.md` section E ("Doc-vs-code drift truth sources").

#### 6. LLM-optimization check

Walk c7score-style criteria against the doc(s) in scope, sourcing the methodology from `src/skills/docs-optimize/REFERENCE.md` and `src/skills/docs-optimize/references/c7score_metrics.md` as reference files. Emit a finding for each violation, tagged `c7score`:
- Question coverage (snippets answering "How do I X?")
- Self-contained example completeness
- Metadata snippet pollution
- Import-only / install-only fragments

The omnibus routes `c7score`-tagged findings to `docs-optimize` for the fix pass. This leaf does not call it directly (per architecture R1: only the omnibus chains skills).

#### 7. Drift between peer docs

Compare docs in scope against other docs in their family (sibling SKILL.md files, sibling module READMEs, etc.). Emit a finding for each divergence, tagged `peer-drift`, with `relatedLocations` pointing at the canonical reference and the drifted peers:
- Structural divergence (this README has Verification section; peers don't)
- Voice divergence (this guide is terse; peers are verbose)
- Frontmatter divergence (some have `argument-hint`; others don't)

The omnibus routes `peer-drift`-tagged findings to `docs-conform` for the fix pass. This leaf does not call it directly (per architecture R1: only the omnibus chains skills).

#### 8. Compile the phased plan

Group findings into three phases:

- **Phase 1 — Critical:** drift, false claims, broken cross-refs, missing required content
- **Phase 2 — Refinement:** structure, density, formatting, missing TOC
- **Phase 3 — Polish:** voice, AI tells, c7score finetune, microcopy

Each finding includes: the rule violated (RULES.md section + filename), the location (`file:line`), the proposed fix, and a confidence rating.

#### 9. Wait for approval

Present the plan. Do not implement anything. The user may reorder, cut, or modify any recommendation. Execute only what's approved, surgically. After each phase: present results for review before moving to the next.

### Output format

```
# Docs Review (audit): <scope>
Last Updated: YYYY-MM-DD

## Executive Summary
<1–2 sentences on current state>

## Scope
<files audited>

---

## PHASE 1 — Critical
[finding] — RULES.md §<X> / <file:line> — Confidence: High/Medium/Low
  Fix: <concrete change>

## PHASE 2 — Refinement
[finding] — RULES.md §<X> / <file:line>
  Fix: <concrete change>

## PHASE 3 — Polish
[finding] — RULES.md §<X> / <file:line>
  Fix: <concrete change>

---

## Pre-existing Issues (out of scope)
<findings outside the audit window>

## Drift findings — tagged `peer-drift` for omnibus routing
<files where peer drift detected; reference + drifted peers in relatedLocations>

## C7Score findings — tagged `c7score` for omnibus routing
<snippets / sections flagged>

## Next Steps
<approval gate>
```

Default save path: `./dev/active/[task-name]/[task-name]-docs-review.md`

### Done when (audit)

- All audited docs covered with specific, actionable findings
- Every finding cites a RULES.md section + file:line
- Drift findings tagged `peer-drift`; c7score findings tagged `c7score` (omnibus routes to fix leaves)
- Plan saved to file
- Parent process informed: "Docs review (audit) saved to: [path]"

**Do NOT implement fixes automatically.** Always end with: "Please review the findings and approve which changes to implement before I proceed."

---

## Mode: fix

Agent-backed via `docs-reviewer`. Applies edits derived from audit findings. Each finding's `properties.tag` routes it to a fix shape; the agent executes the change minimally and verifies the doc still parses, references resolve, and behavior claims still match code.

### Dispatch

When `mode: fix`, this skill dispatches `Agent(subagent_type: "docs-reviewer")` with the approved findings + scope. The docs-reviewer agent runs a two-phase workflow:

- **Phase 1 — Write / Update** — follows `docs-author/SKILL.md` to write or update content from source context (used for stub-fills and significant rewrites authorized by the finding).
- **Phase 2 — Review & Optimize** — follows `docs-optimize/SKILL.md` for accuracy review against actual behavior and c7score / llms.txt improvements.

This skill is the dispatch wrapper; the actual edit + verification work lives in the agent and the two skills it loads.

### Inputs

1. **Findings** (preferred) — SARIF v2.1.0 from the audit pass, passed inline (omnibus path) or read from disk.
2. **Reference** (optional, only when no findings provided) — a canonical doc; runs an inline audit pass first.
3. **Scope** — inherited from findings; never expands beyond them.
4. **Phase filter** (optional) — `--phase critical,refinement` to limit which severity tiers get applied.

### Process

#### 1. Resolve findings

If findings provided (omnibus path), parse the SARIF and group by `properties.tag`. Otherwise run the audit mode inline against the scope and gate on user approval.

#### 2. Group by fix shape

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

#### 3. Plan the edits

Compute the minimal `Edit` per finding. Group edits by file.

**Hard rules:**

- **Never rewrite a doc wholesale** unless the finding explicitly authorizes it and the user approved that specific finding.
- **Never enforce a dimension not in the finding.** A `voice` finding doesn't license a structural reorganization.
- **Preserve domain content.** Peer-drift propagation copies structure, not specific content (file paths, command names, prose body).
- **Removed content goes completely.** Per Commandment 7: no `<!-- removed -->` markers, no orphaned anchors, no commented-out sections "for reference."
- **No scope creep.** Adjacent issues surface as new findings, not new edits.

#### 4. Show the plan

Output the planned edits as a unified diff or per-file edit list. For omnibus-dispatched runs with prior approval, proceed to step 5. For direct invocation, stop and wait.

#### 5. Apply edits

1. **Same-file edits in reverse line order** (so earlier-line edits don't shift later-line references).
2. **Cross-file edits last** (peer-drift propagation across many files; one canonical edit applied to multiple peers).
3. **Frontmatter changes first within a file**, then body, then trailing references.

After each file is edited, re-check the targeted RULES.md rule to confirm the finding resolved.

#### 6. Verify

Run `gate("docs")` from `VERIFICATION.md`. For Construct today this is not yet implemented (`omnibus.yml` shows `docs: ""`); when absent, perform these checks inline:

- **Markdown parses** — every changed doc renders without warnings via the docs pipeline.
- **Cross-references resolve** — for each `[text](path)` and `@path` reference in the changed docs, confirm the target exists.
- **Frontmatter parses** — YAML frontmatter (where present) is valid.
- **`gate("code")` green** — confirms no test that references a changed doc broke (e.g., skill-rules-driven tests).

If any check fails:

- Identify which fix likely caused the issue.
- Either revert that fix and surface a new finding, OR adjust the fix and re-run the checks.
- Never silence a check or remove a reference to "fix" the gate.

#### 7. Summarize

One paragraph: which findings were resolved, which files were touched, which findings were skipped and why.

### Tag-specific detail

#### Peer-drift propagation

For `tag: peer-drift` findings where `relatedLocations[0]` is the canonical reference:

1. Read the reference along the chosen dimension (structure / voice / frontmatter shape).
2. Compute the minimal Edit on the peer to match.
3. Preserve domain-specific prose, file paths, and example values.
4. Check for other peers in the same family — if they need the same fix, surface as new findings rather than expanding scope.

#### c7score optimization

For `tag: c7score` findings:

1. Read the optimization detail in `properties.fix` — usually one of: add a question-answering snippet, expand an import-only fragment, mask metadata snippets, restructure a section to be self-contained.
2. Apply the change with the doc's existing voice / formatting conventions.
3. If the optimization requires significant rewriting, surface as a `severity: suggestion` finding for the user rather than auto-applying.

#### Drift correction

For `tag: drift` findings (doc claim contradicts code):

1. Read the cited code lines.
2. Read the cited doc lines.
3. Determine which is correct (usually code wins; sometimes doc surfaces a bug in code).
4. If code wins: rewrite the doc to match.
5. If doc wins: surface a `code-review --mode fix` finding to fix the code (do not silently auto-edit the code from this skill).

### Fix output

```
[plan]
... edit list, grouped by file ...
[/plan]

[applying]
... per-edit lines ...
[/applying]

[verify]
scope:      <files edited>
method:     gate("docs") (markdown parse + cross-ref resolution + frontmatter parse + gate("code"))
assertions: every changed doc parses; every cross-reference resolves; full test suite passes
[/verify]

# Summary
- <N> findings resolved
- <M> files edited
- <K> findings skipped (with reasons)
- Manual review suggested: <files>
```

### Guardrails (fix)

- **Verification is non-negotiable.** Never claim done without the four inline checks (parse + xref + frontmatter + gate("code")) green in the turn's tool output.
- **Approved findings only.** No fix without an approved finding.
- **Preserve domain content.** Propagation copies structure; never the body.
- **No scope creep.** Adjacent issues are new findings, not new edits.
- **No `Skill()` calls.** The omnibus dispatches; the docs-reviewer agent applies; this skill is the wrapper.

---

## Mode: enforce

Self-invoked, not orchestrator-dispatched. When the agent is about to write or edit markdown content — README, AGENTS.md, SKILL.md, INSTALL.md, guides, API docs, design docs — it activates this mode for the duration of the write. No audit pass, no findings emitted, no plan presented. The rules in `src/rules/docs/RULES.md` are applied silently to the produced output.

If the user wants violations *flagged* in existing docs → use `mode: audit`.
If the user wants peer docs aligned to a reference → use `mode: fix` with `tag: peer-drift`.
If the user wants LLM-readability optimization on what was just written → emit `c7score`-tagged findings for the omnibus to route to `docs-optimize`.

### Process (enforce)

#### Phase 1: Discovery

- Check memory (MCP or notes) for stored knowledge about the feature/system being documented.
- Scan existing documentation directories for related docs — match their voice and structure.
- Identify all related source files and configuration.
- Map system dependencies and interactions.

#### Phase 2: Analysis

- Understand the complete implementation, not just the surface.
- Identify key concepts that need explanation.
- Determine the target audience and what they already know.
- Recognize patterns, edge cases, and known gotchas.

#### Phase 3: Documentation

- Apply every rule in `src/rules/docs/RULES.md` while writing — voice, formatting, density, structure, accuracy. No before/after.
- Structure content logically with clear hierarchy.
- Write concise but comprehensive explanations.
- Include practical, working code examples with language tags.
- Add diagrams where visual representation helps.
- Match the style of existing documentation in the project.

#### Phase 3b: LLM-optimization pass

Walk c7score-style criteria against the doc(s) just written, sourcing the methodology from `src/skills/docs-optimize/REFERENCE.md` and `src/skills/docs-optimize/references/c7score_metrics.md`:

- Question-coverage: do snippets answer concrete "How do I X?" questions?
- Self-contained examples: every snippet runnable, with imports
- Language tags on every code block
- No metadata snippet pollution (licensing, directory trees, citations)
- No import-only or install-only fragments

Emit `c7score`-tagged findings for any violation. The omnibus routes them to `docs-optimize`. This skill does not call it directly (per architecture R1: only the omnibus chains skills).

#### Phase 4: QA

- Verify all code examples are accurate and runnable.
- Check that all referenced file paths exist.
- Confirm documentation matches current implementation.
- Include troubleshooting sections for common issues.

### Location strategy (enforce)

- Prefer feature-local documentation (close to the code it documents).
- Follow existing patterns already established in the codebase.
- Ensure documentation is discoverable — don't bury it.

### Special cases (enforce)

- **APIs:** include usage examples, response schemas, error codes.
- **Workflows:** create flow diagrams, state transitions.
- **Config:** document all options with defaults and examples.
- **Integrations:** explain external dependencies and setup requirements.

### Before writing (enforce)

For non-trivial new docs, explain your documentation strategy before creating files:

- What context did you find and from where?
- What structure will you use?
- Where will files be placed and why?

Get confirmation before proceeding. For one-off edits to an existing doc, just apply the rules and produce the output.

### Output (enforce)

There is no output format. Enforcement produces docs, not a report.

---

## Cross-references

- Rule source: `src/rules/docs/RULES.md`
- Suggested additions: `src/rules/docs/SUGGESTIONS.md`
- Finding contract: `src/skills/_shared/finding.md`
- Agent (fix mode): `src/agents/docs-reviewer.md`
- Sibling unified review skills: `code-review`, `design-review`, `security-review`, `agent-review`
- LLM-discoverability reference: `src/skills/docs-optimize/REFERENCE.md`
- Orchestrator: `src/skills/omnibus/SKILL.md`
- Verification gate table: `VERIFICATION.md`
