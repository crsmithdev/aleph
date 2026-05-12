# Agents Rules

Authoritative rules for subagent definitions (`src/agents/*.md` and `.claude/agents/*.md` in non-Construct projects). Read by:

- `src/skills/agents-audit/SKILL.md` — flags violations in existing agents (post-hoc)
- CLAUDE.md (project-local + global) — applies these rules silently at write-time

Every rule is **checkable**: it can be evaluated against a real agent definition and produce a SARIF finding (per `src/skills/_shared/finding.md`). agnix covers AGM-* and XP-* structural lint; this file covers semantic rules agnix doesn't.

Scope: every agent markdown file (`src/agents/<name>.md`, `~/.claude/agents/<name>.md`, `.claude/agents/<name>.md`) plus any place an agent name is referenced from skills or hooks.

---

## A. Frontmatter

*Sources: Claude Code subagent spec, agnix AGM-* / XP-* rules.*

### A.1 Required fields present

Every agent frontmatter must include `name:` and `description:`. Optional but recommended: `tools:` (whitelist), `model:` (if not inherited).

- **Detect:** parse YAML frontmatter; flag missing `name` or `description`
- **Severity:** `important`
- **Tag:** `frontmatter`

### A.2 `name:` matches the filename

The `name:` field must equal the filename minus extension. Mismatches confuse the dispatcher.

- **Detect:** for each `src/agents/<n>.md` (or equivalent), parse frontmatter and confirm `name == <n>`
- **Severity:** `important`
- **Tag:** `naming`

### A.3 `model:` is a recognized Claude model ID or absent

If specified, `model:` must be a current model ID (e.g., `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5`, or the short aliases `opus`/`sonnet`/`haiku`). Stale model IDs (e.g., 3.x) are bugs.

- **Detect:** `model:` values that don't match the current model-ID list (refresh from `~/.claude/CLAUDE.md` `Environment` section)
- **Severity:** `important`
- **Tag:** `stale-model`

---

## B. Description quality

*Sources: practical observation — the dispatcher reads the description to decide routing.*

### B.1 Description specifies when to use AND when NOT to use

Without negative scope, the dispatcher routes too broadly. A good description has the form: "Use when X, Y, Z. Do NOT use when A, B, C (use `<other-agent>` instead)."

- **Detect:** descriptions shorter than 120 characters; descriptions with no negative framing AND with overlap with a sibling agent's description (parser-driven keyword overlap check)
- **Severity:** `important`
- **Tag:** `description-quality`

### B.2 Description names the output contract

What does the parent get back? Free-form text? A structured summary? The description should say.

- **Detect:** descriptions that don't mention "reports", "returns", "summarizes", or "produces"
- **Severity:** `nit`
- **Tag:** `description-quality`

---

## C. Tool whitelist

*Sources: subagent security model — minimum-necessary tool grants.*

### C.1 `tools:` whitelist is minimum-necessary

Agents should declare only the tools they need. A code-debugger doesn't need `Bash`-with-write; a doc-reviewer doesn't need `Edit`.

- **Detect:** heuristic — agents with `tools:` lists including `Edit` / `Write` but whose description is read-only ("audit", "review", "report")
- **Severity:** `nit`
- **Tag:** `over-privileged`

### C.2 No `Task` tool in subagent tool lists

Subagents must not spawn subagents (per `docs/plans/skill-architecture.md` R1 and the equivalent constraint for agents). The `Task` / agent-spawning tool is for the top-level model only.

- **Detect:** `tools:` arrays containing `Task` or the equivalent agent-spawning entry
- **Severity:** `important`
- **Tag:** `r1-violation`

---

## D. Trigger overlap

*Sources: practical observation — agent dispatch ambiguity is a top cause of wrong-routing.*

### D.1 Description trigger phrases don't collide with sibling agents

Agents whose descriptions both promise to handle the same kind of request create dispatch ambiguity — the model picks one, often the wrong one.

- **Detect:** parse all agent descriptions; flag pairs whose trigger-keyword overlap exceeds ~60% (heuristic: noun phrases like "code review", "design audit", "research" appearing in 2+ descriptions without distinguishing modifiers)
- **Severity:** `important`
- **Tag:** `routing-collision`

---

## E. Output contract

*Sources: practical observation — undocumented output contracts cause silent integration drift.*

### E.1 Description states what the parent process can expect

If the agent produces structured output (JSON, SARIF, a table), the description must say so. Free-form output is acceptable when the parent treats it as a free-form report.

- **Detect:** agents with structured-output verbs ("produces SARIF", "returns JSON") in their workflow but no statement in the description
- **Severity:** `nit`
- **Tag:** `contract-drift`

### E.2 Agents don't promise capabilities they lack

If the description mentions a tool or skill (e.g., "uses Playwright") but the agent's `tools:` whitelist doesn't include it (or no skill of that name exists), the description is aspirational.

- **Detect:** parse description tool/skill references; cross-check `tools:` whitelist and skill registry
- **Severity:** `important`
- **Tag:** `agent-drift`

---

## F. Statelessness

*Sources: Claude Code subagent execution model — each invocation runs in a fresh context.*

### F.1 Agents don't reference "the previous turn" or "earlier in this session"

Subagents start with no conversation history beyond what the parent passes them. Prompts that assume continuity are bugs.

- **Detect:** agent body text containing phrases like "as we discussed", "earlier", "the previous turn", "your previous response"
- **Severity:** `nit`
- **Tag:** `statelessness`

---

## Negative-filter list (uniform with other audit leaves)

Per `src/skills/_shared/finding.md`:

- Style preferences not in this file → drop
- Pre-existing issues outside scope → record under "Pre-existing Issues" SARIF run
- Issues agnix AGM-* / XP-* covers → cite agnix's rule, pass through
- Pedantic nitpicks → drop
- Lint-ignored entries → drop

---

## Approval policy

Agent findings default to `approval: single` per `omnibus.yml` `by_domain.agents`. Exceptions:

- `tag: over-privileged` (granting write/edit tools to read-only agents) → `per-finding` (security-adjacent)
- `tag: r1-violation` (Task tool granted to subagent) → `per-finding`

There is currently no `agents-fix` leaf. Once authored, fix-flavor approval mirrors audit-side severity.
