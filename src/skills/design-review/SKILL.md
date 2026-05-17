---
name: design-review
description: Review UI design quality — audit findings (default) or apply approved fixes (mode: fix). Audit mode is agent-backed via design-reviewer (needs browser/ui:smoke). Fix mode runs inline source edits. Evaluates rules in src/rules/design/RULES.md across 18 dimensions (visual hierarchy, typography, color, alignment, components, iconography, motion, state coverage, dark mode, density, responsiveness, accessibility, forms, performance, navigation, hydration, locale, anti-patterns). Triggers on /audit design, /fix design, /design-review, "audit the ui", "review the ui", "polish the interface", "design review", "make this feel professional", "make the pages match", "align the layouts".
verb: review
domain: design
modes: [audit, fix]
agent_backed:
  audit: design-reviewer
metadata:
  author: bencium (adapted)
  version: "3.0.0"
  argument-hint: <scope-or-page-url> [--mode audit|fix]
---

# Design Review

Single entry point for design quality work. Defaults to `audit`; switch to `fix` once findings are approved.

| Mode | Dispatch | Mutating | Purpose |
|---|---|---|---|
| `audit` (default) | **Agent-backed** via `design-reviewer` subagent (needs browser tools + `bun run ui:smoke` for visual rendering) | No | Walks UI surfaces, evaluates every rule in `src/rules/design/RULES.md`, emits SARIF + phased prose summary |
| `fix` | **Inline** — direct source edits to React/CSS by this skill | Yes | Applies approved `peer-drift` findings (or runs an inline audit pass first), then verifies with `gate("design")` |

Pure leaf: no `Skill()` calls. The omnibus chains audit → approval → fix.

## When to use

- User asks to review/audit a screen, page, or component for visual/UX quality → `mode: audit`.
- User invokes `/design-review`, `/audit design`, `/fix design`, or the omnibus dispatches the `audit`/`fix` verb to the `design` domain.
- After an audit produced approved `tag: peer-drift` findings → `mode: fix`.
- User invokes `/design-review <reference> --mode fix` directly — runs an inline audit pass against that reference (no SARIF input), asks for approval, then applies.

## When NOT to use

- Logic/feature work — out of scope. Use `code-review`.
- Active bugs / runtime failures — use `code-debug`.
- Logic/data drift across peers — use `code-conform` (not a design pattern).
- Documentation drift — use `docs-review`.
- Subagent definitions — use `agent-review`.
- Security review — use `security-review`.
- Pure typography correctness (smart quotes, em dashes, character entities) — surfaces in audit as `tag: typography` findings citing `design/RULES.md#B`; fix mode propagates *patterns*, not individual character substitutions.
- Single-page polish with no peers — just edit directly.
- Net-new features — fix mode propagates *patterns*, not roadmap items.

## Inputs

### Common
1. **Mode** — `audit` (default) or `fix`.
2. **Scope** — default smart: `--diff` against `origin/main`, `--module <path>`, `--since <git-ref>`, or `--all`.
3. **Threshold** (optional) — confidence floor 0-100; default 80 per `omnibus.yml`.

### Audit mode
4. **Reference** (optional) — a file/component when the audit is reference-anchored.

### Fix mode
5. **Findings** (preferred path, omnibus dispatch) — SARIF v2.1.0 with `tag: peer-drift`. Each finding's `locations[0]` is the drifted peer; `relatedLocations[0]` is the canonical reference.
6. **Reference** (required for direct invocation) — file path, component name, or description of recent work. Always something concrete you can read and load in a browser.
7. **Notes** (optional) — which dimensions to focus on or ignore.
8. **Mode flags** (optional) — `--report` for audit-only (emits SARIF and stops; equivalent to `mode: audit`), `--all` to include legacy pages (default: only files in the current session's diff).

## Process — `mode: audit`

This mode dispatches to the **`design-reviewer` agent** because it needs browser tools and `bun run ui:smoke` to render and visually inspect surfaces. The agent reads this SKILL.md and executes the steps below.

### 1. Resolve scope

```bash
git diff --name-only origin/main...HEAD -- 'src/ui/**'
find <path> -name '*.tsx' -not -path '*/node_modules/*'
find src/ui -name '*.tsx' -not -path '*/node_modules/*'   # --all
```

**Smart default:** try `--diff` first. If empty, stop and surface *"No files in scope: `origin/main...HEAD` is empty. Try `--module <path>`, `--since HEAD~5`, or `--all`."* — do not silently audit nothing.

### 2. Walk the rules

For each in-scope file, evaluate every section A through R in `src/rules/design/RULES.md`. Each rule's `Detect:` line specifies the signal (grep, structural check, or "render and read"). Qualitative rules (hierarchy, motion, alignment rhythm) require visual reasoning — render the surface via `bun run ui:smoke` or the dev server and anchor each finding to a specific JSX node (`file:line`).

When a rule's Detect signal doesn't apply to the current scope (e.g., form rules on a screen with no form), skip silently.

For detailed audit instructions on qualitative dimensions, read `references/design-principles.md` (progressive disclosure).

### 3. Apply the reduction filter

For every element on every screen:

- Can this be removed without losing meaning? Remove it.
- Would a user need to be told this exists? Redesign until obvious.
- Does this feel inevitable? If not, it's not done.
- Is visual weight proportional to functional importance? If not, fix hierarchy.

### 4. Apply negative-filter list

Per `src/skills/_shared/finding.md`:

- Style/quality concerns not in RULES.md → drop
- Pre-existing issues outside scope → record under "Pre-existing Issues", not in primary findings
- Pedantic nitpicks → drop
- Linter-catchable → cite `eslint/<rule>` or `agnix/<rule>`, mark `severity: nit`
- Lint-ignored lines → drop

### 5. Emit SARIF

Single SARIF v2.1.0 run, `tool.driver.name = "design-review"`. Each `result`:

```json
{
  "ruleId": "design/RULES.md#<section-letter>",
  "level": "error" | "warning" | "note" | "none",
  "message": { "text": "<one-line description>" },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "..." }, "region": { "startLine": N, "endLine": N } } }],
  "properties": {
    "confidence": 0,
    "severity": "blocking" | "important" | "nit" | "suggestion" | "learning" | "praise",
    "fix": "<concrete proposed change>",
    "tag": "<from RULES.md Tag: line — tokens, typography, a11y, state-coverage, peer-drift, etc.>",
    "scope": "diff" | "module" | "all"
  }
}
```

`confidence` is provisional; the omnibus validation pass refines it.

When proposing `praise`, the bar is concrete: the surface solves a common visual anti-pattern with a clean solution worth propagating. Praise must (a) cite a specific RULES.md rule the surface exemplifies the opposite of, and (b) carry "use this as a reference for: <pattern>" in `fix` so `mode: fix` can use it as the anchor for aligning peers.

If no surface qualifies, omit praise. Don't manufacture it.

### 6. Emit a phased prose summary

After the SARIF block:

```
# Design Review — Audit — <scope>

## Phase 1 — Critical (blocking + important)
- <file:line> — <rule> — <one-line> (confidence X)

## Phase 2 — Refinement (nit)
- ...

## Phase 3 — Polish (suggestion + learning)
- ...

## Praise
- <file> — <rule exemplified> — use as reference for <pattern>

## Pre-existing issues (out of scope)
- ...
```

SARIF severity → phase mapping: `blocking + important` → Phase 1; `nit` → Phase 2; `suggestion + learning` → Phase 3. The legacy Critical / Refinement / Polish grouping is preserved.

For the exact phased output template (when run standalone, not via omnibus), see `references/audit-template.md`.

### 7. Wait for approval

Present the SARIF + phased prose. Do not implement anything — fix mode applies approved fixes.

## Process — `mode: fix`

This mode runs **inline** in the current session — direct source edits to React components / CSS / Tailwind classes. No subagent dispatch.

### 1. Resolve findings

If findings provided (omnibus path), parse the SARIF and group by reference (multiple peers may point at the same canonical surface). Otherwise run an inline audit pass:

1. Read the reference file. If the user pointed at a section or recent edit, locate the exact lines. If the reference is ambiguous, ask before proceeding.
2. Identify what's distinctive — see step 2.
3. Find peers — see step 3.
4. Compare and emit `peer-drift` findings — see step 4.
5. Gate on user approval before applying.

### 2. Identify what's distinctive

Extract the *pattern* — not the whole file. Five dimensions:

- **Layout & rhythm** — vertical spacing, container widths, alignment, density
- **Component composition** — which primitives are used (`<PageHeader>`, `<DataTable>`, `<Card>`); ad-hoc structures vs shared components
- **State coverage** — does the reference handle loading / empty / error / skeleton uniformly, and do peers?
- **Tokens** — color, type scale, radius, shadow; are peers using `text-text-muted` and `bg-bg-secondary` or hex codes?
- **Microcopy shape** — empty-state phrasing, error sentence shape, button verb tense

If the user gave notes ("only the header"), narrow to that. Otherwise default to *everything that looks like an intentional pattern* — skip incidental differences (specific text content, page-specific data shapes).

For the full taxonomy, see `references/dimensions.md`.

### 3. Find peers

Auto-detect candidates by, in order:

1. Filename pattern (`*Page.tsx`, `*Table.tsx`, `*DetailPage.tsx`)
2. Directory siblings of the reference
3. Files that import the same layout primitive (e.g. all `<PageHeader>` consumers, all `<DataTable>` consumers)
4. Components rendered by the same parent route
5. Files Claude has touched recently in this session (when in default diff-only mode)

If the user gave an explicit scope, use that as a filter on the candidates.

**Always present the peer list before doing any work.** "Found 7 peers: A, B, C, D, E, F, G. Trim or proceed?" Let the user remove false positives.

### 4. Plan the edits

For each peer + dimension, compute the minimal `Edit` to bring it in line with the reference. Group edits by file so the patch lands atomically per file.

Rank severity:

- **Major** — pattern is missing entirely (no `<PageHeader>`, missing empty state, hand-rolled `<h1>` instead of `<PageTitle>`)
- **Minor** — pattern is present but degraded (font size off, padding inconsistent, header missing breadcrumb slot)
- **Stylistic** — pattern matches but small surface differences (icon size, hover color)

**Hard rules:**

- **Never rewrite a file wholesale** unless the user explicitly authorizes it and the finding's `properties.fix` says "rewrite".
- **Never enforce a dimension the user didn't ask for** when notes are present.
- **Never trigger on legacy files in default mode.** Diff-only by default.
- **No scope creep.** If a fix surfaces an adjacent issue, log it as a new finding for the next audit — don't fix it in this pass.
- **Removed code goes completely.** Per Commandment 7: no `// removed` markers, no orphaned imports.

### 5. Reference-as-outlier check

Before proposing fixes, sanity-check: if the reference differs from a *majority* of its peers, surface this:

> "Note: 5 of 7 peers don't follow the reference's layout. Is the reference the new canonical, or did I pick the wrong anchor?"

User can confirm "reference wins" (proceed) or flip the anchor.

### 6. Show the plan

Output the planned edits as a unified diff or per-file edit list. For omnibus-dispatched runs with prior approval, proceed directly to step 7. For direct invocation, stop and wait for the user.

### 7. Apply edits

- Read each peer file.
- Compute the minimal `Edit` to bring it in line with the reference *for the chosen dimensions*.
- Use shared primitives over hand-rolled markup (replace inline `<h1 class="...">` with `<PageHeader>`).
- Preserve domain content, page-specific data shapes, and incidental differences.
- **Do not** import unused things; **do not** add visual elements (icons, badges) the peer didn't already have.

### 8. Verify

Run `gate("design")` from `VERIFICATION.md`. The skill MUST NOT claim done until the gate is green and the affected routes have been eyeballed.

`bun run build` alone is not sufficient — per `feedback_ui_done_requires_page_load`, build pass ≠ feature works. For any rendering bug, drive a real browser and measure the element.

For changes that touch shared types or API contracts, also run `gate("code")`.

If `gate("design")` fails:

- Identify which peer change broke the render.
- Either revert that change and surface a new finding, OR adjust the fix and re-run the gate.
- Never silence a failing assertion to make the gate pass.

See `references/verification.md` for the full verification workflow.

### 9. Summarize

One paragraph: which peers were aligned, which were skipped and why, and what (if anything) the user should still review by eye.

## Default scope: diff-only (fix mode)

By default, only consider peers that:

- Were edited in the current session, OR
- Are explicitly named in the user's invocation, OR
- Are auto-detected and confirmed in step 3

This prevents drowning the user in legacy drift. Use `--all` to include every peer in the codebase.

## Worked invocations

```
/design-review                                         # audit, smart scope (--diff)
/design-review --mode audit src/ui/web/src/pages
/design-review --mode fix src/ui/web/src/components/data/DataTable.tsx
  → peers = consumers of DataTable; align column-typing patterns

/design-review --mode fix src/ui/web/src/components/layout/PageHeader.tsx
  → peers = consumers of PageHeader; align title font and breadcrumb usage

/design-review --mode fix src/ui/web/src/pages/system/observability/EvalsPage.tsx — table only
  → narrow to the table; ignore page-level chrome

/design-review --mode fix the loading state across all detail pages
  → no fixed anchor; skill picks the cleanest, asks for confirmation

/design-review --mode fix --report
  → audit only, no fixes; emits SARIF with tag: peer-drift
```

For three fully worked fix-mode cases, see `examples/`:

- `examples/table-consistency.md`
- `examples/page-header-alignment.md`
- `examples/typography-floor.md`

## Output

### Audit mode

SARIF block first (omnibus consumer), prose phased report after (human reader):

```
[sarif]
{ ... SARIF v2.1.0 ... }
[/sarif]

# Design Review — Audit — <scope>
<phased prose>
```

When invoked by the omnibus, return the SARIF as the structured result; the omnibus assembles the cross-domain phased report.

### Fix mode

```
[plan]
Reference: <path>[:section]
Pattern dimensions: <list, derived from reference + notes>
Peers considered: <count>
Drift: Major <n> / Minor <n> / Aligned <n>

... edit list ...
[/plan]

[applying]
... per-edit lines ...
[/applying]

[verify]
scope:      <files edited>
method:     gate("design")
assertions: every route renders, no 5xx, no console errors; eyeballed <list>
[/verify]

# Summary
- <N> peers aligned
- <M> files edited
- <K> peers skipped (with reasons)
- Manual review suggested: <files>
```

## Scope discipline

- **Audit is read-only.** No `Edit`, `Write`, or mutating `Bash` in `mode: audit`. Bash for `git diff`, `grep`, `find`, screenshot capture only.
- **Fix is mutating but minimal.** Only edit peers identified by approved findings; do not rewrite wholesale.
- **No `Skill()` calls.** The omnibus chains; we audit or fix.
- **Verification gate.** `gate("design")` runs only when `mode: fix` finishes applying changes. Audit mode is non-mutating and has no gate.
- **Design only, not logic.** If a finding requires a functional change, flag it and surface — outside this skill's scope.

## Guardrails

- **Confidence is provisional.** Omnibus validation pass refines it.
- **Cite rules precisely.** Every finding includes `design/RULES.md#<anchor>`. No bare prose accusations.
- **Anchor qualitative findings to JSX nodes.** "The hierarchy is off" without a `file:line` is not a finding.
- **Praise is intentional.** Specific, with a propagation pointer.
- **Negative-filter is non-negotiable.** When in doubt, don't flag.
- **Verification is non-negotiable (fix mode).** Never claim done without a green `gate("design")` result in the turn's tool output. `bun run build` alone is insufficient — it does not catch runtime render errors.
- **Approved findings only (fix mode).** No fix without an approved finding (inline audit + user approval, or omnibus-passed approved SARIF).
- **Never propose fixes without showing the peer list first.** The user must be able to trim false positives before any edits.
- **Surface intentional divergence.** If a peer has `// conform:exempt` or an obvious comment indicating intentional difference, skip it and note in the report.
- **One reference, one pass.** Don't try to enforce multiple unrelated patterns in a single invocation.

## Cross-references

- Rule source: `src/rules/design/RULES.md`
- Reference sub-rules: `src/rules/design/accessibility.md`, `src/rules/design/typography.md`
- Finding contract: `src/skills/_shared/finding.md`
- Audit-mode agent: `src/agents/design-reviewer.md`
- Progressive-disclosure detail: `references/design-principles.md`, `references/audit-template.md`, `references/dimensions.md`, `references/verification.md`, `examples/`
- Sibling review skills: `code-review`, `docs-review`, `security-review`, `agent-review`
- Orchestrator: `src/skills/omnibus/SKILL.md`
- Verification gate table: `VERIFICATION.md`
