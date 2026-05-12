---
name: agents-fix
description: >
  Apply fixes for agents-audit findings — add missing frontmatter, rename to
  match filename, update stale model IDs, rewrite vague descriptions to
  include explicit when-to-use / when-NOT-to-use, narrow over-privileged
  tool whitelists, remove the Task tool from subagent tool arrays (R1),
  disambiguate routing-collision pairs, document the output contract, fix
  capability drift, and strip statefulness from prompts. Takes SARIF findings
  from `agents-audit` as input. Triggers on "fix the agents findings",
  "remediate agent drift", "fix agent dispatch ambiguity", "/agents-fix",
  "/fix agents", or when the omnibus dispatches the fix verb to the agents
  domain after approval.
verb: fix
domain: agents
modes: [fix]
---

# Agents Fix

Applies edits derived from `agents-audit` findings. Each finding's `properties.tag` routes to a fix shape; this skill executes the change minimally.

Pure leaf: no `Skill()` calls. The omnibus chains audit → approval → fix.

## When to use

- After `agents-audit` produced findings and the user approved them.
- User invokes `/agents-fix` against a saved SARIF report, or `/fix agents` via the omnibus.

## When NOT to use

- Authoring a net-new agent → that's just markdown; no author-mode skill yet.
- Skill-registry fixes → `skills-fix`.
- Hook-script fixes → `hooks-fix`.
- General code fixes → `code-fix`.

## Inputs

1. **Findings** (required) — SARIF v2.1.0 from `agents-audit`.
2. **Approvals** — per `omnibus.yml.by_domain.agents` (single by default; `over-privileged` / `r1-violation` tags upgrade to per-finding).
3. **Scope** — inherited from findings.

## Process

### 1. Resolve findings

Parse SARIF; group by `properties.tag`.

### 2. Map tag → fix shape

| Tag | Fix shape | What it does |
|---|---|---|
| `frontmatter` | Field addition | Add missing `name:` / `description:` (always required); add `tools:` and `model:` when the finding indicates the agent's tool grant or model isn't inheritable |
| `naming` | Rename | Rename the agent file to match `name:`, OR update `name:` to match the filename (per-finding decision) |
| `stale-model` | Model ID refresh | Update `model:` to a current Claude model ID (refresh from `~/.claude/CLAUDE.md` Environment section); the audit pass cites the current valid list |
| `description-quality` (length / scope) | Description rewrite | Apply the rewritten description from `properties.fix`. Required structure: ≥120 chars; "Use when X, Y, Z. Do NOT use when A, B, C (use `<other-agent>` instead)"; mention output contract |
| `description-quality` (output contract) | Add contract line | Add a sentence to the description naming what the parent process can expect back (free-form text vs structured output) |
| `over-privileged` | Tool removal | Remove `Edit` / `Write` / `Bash` from the `tools:` whitelist for read-only agents (description verbs "audit", "review", "report") |
| `r1-violation` (Task tool) | Remove Task tool | Remove `Task` (or the equivalent agent-spawning tool) from `tools:`. Subagents cannot spawn subagents |
| `routing-collision` | Disambiguate | Apply the suggested rewrite from `properties.fix`. Typical: add a distinguishing modifier ("architectural review only" vs "diff-line nit review only"); or merge if the agents truly do the same thing |
| `contract-drift` | Document the structure | Add the output-contract statement to the description; if the agent's body promises structured output not implemented, surface as a `code-audit` finding (don't auto-edit body logic) |
| `agent-drift` (capability mismatch) | Tool / skill alignment | If `tools:` doesn't include a referenced tool, add it (with security review). If a referenced skill doesn't exist, either author it or remove the reference. Surface as per-finding |
| `statelessness` | Strip continuity refs | Remove phrases like "as we discussed", "earlier", "your previous response" from the agent body |

For findings without a clean tag mapping, treat `properties.fix` as the literal change.

### 3. Plan the edits

Compute the minimal `Edit` per finding.

**Hard rules:**

- **Over-privileged removal requires per-finding approval** — removing `Edit` from a tool list might break a workflow the user relies on. Surface the tools being removed.
- **Renaming agents needs explicit approval** — invalidates references from skills / hooks / cross-references.
- **Routing-collision rewrites are creative work** — the auto-suggested rewrite may need user adjustment. Surface the proposed rewrite, accept the user's revision.
- **Removed code goes completely.** Per Commandment 7: no `// removed` markers, no orphaned tool grants.
- **No scope creep.** Adjacent issues become new findings.

### 4. Show the plan

Output the planned edits.

### 5. Apply edits

Order:

1. **Frontmatter edits** (atomic, low blast radius).
2. **Description rewrites** (atomic, but verify the rewrite covers when-to + when-NOT-to + output contract).
3. **Tool whitelist edits** (over-privileged removals, Task tool removal).
4. **Body edits** (statelessness phrase strips).
5. **Rename operations** (`git mv` + cross-reference updates) last.

### 6. Verify

Run `gate("agents")` from `VERIFICATION.md`. Per `omnibus.yml`, this is currently `""` (manual). When empty, perform these checks inline:

- **Frontmatter parses** — YAML is valid in every edited file.
- **Re-run `agents-audit --module <touched-files>`** — confirm finding closed without new findings.
- **Cross-reference scan** — for renamed agents, grep `src/` for old name; flag stragglers.
- **`bun test.ts`** — catches regressions from agent renames affecting cross-references.
- **agnix --dry-run** (if installed) — AGM-* / XP-* rules still pass.

If any check fails, revert the offending edit and surface a new finding.

### 7. Summarize

One paragraph: which findings were resolved, which agent files were touched, which renames need follow-up cross-reference updates.

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
method:     gate("agents") (frontmatter parse + agents-audit re-run + cross-ref scan + bun test.ts + agnix)
assertions: zero remaining agents-audit findings in scope; frontmatter valid; no stale cross-references after renames; full test suite passes; agnix structural lint green
[/verify]

# Summary
- <N> findings resolved
- <M> agent files edited
- <R> renames + cross-references updated
- <K> findings skipped (with reasons)
```

## Guardrails

- **Verification is non-negotiable.** All checks (frontmatter + audit re-run + cross-refs + tests + agnix) must show in the turn's tool output.
- **Approved findings only.**
- **Per-finding approval for over-privileged removal and Task-tool removal.**
- **Renames need cross-reference sweep.** A renamed agent might be invoked by other skills / hooks / docs.
- **No scope creep.** Adjacent issues are new findings.
- **No `Skill()` calls.** The omnibus dispatches; we apply.

## Cross-references

- Rule source: `src/rules/agents/RULES.md`
- Finding contract: `src/skills/_shared/finding.md`
- Audit counterpart: `src/skills/agents-audit/SKILL.md`
- Broader audit: `src/skills/config-audit/SKILL.md`
- Architecture: `docs/plans/skill-architecture.md` (R1 — applied to agents)
- Orchestrator: `src/skills/omnibus/SKILL.md`
- Verification gate table: `VERIFICATION.md`
