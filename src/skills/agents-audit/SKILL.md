---
name: agents-audit
description: >
  Audit subagent definitions under `src/agents/` and `.claude/agents/` against
  `src/rules/agents/RULES.md` — frontmatter completeness, description quality
  (when-to-use / when-not), tool-whitelist sanity, no-Task-tool-in-subagents
  (R1 for the agents domain), trigger overlap with sibling agents, output
  contract, and statelessness. Emits SARIF findings (per
  `src/skills/_shared/finding.md`) plus a phased prose report. Read-only —
  no edits. Triggers on "audit agents", "check my agents", "audit subagents",
  "find agent drift", "/agents-audit", "/audit agents", or when the omnibus
  dispatches the audit verb to the agents domain. agnix AGM-* / XP-* covers
  structural lint; this skill adds the semantic layer.
verb: audit
domain: agents
modes: [report]
metadata:
  argument-hint: <agent-name-or-dir>
---

# Agents Audit

Walks subagent definitions in scope, evaluates each rule in `src/rules/agents/RULES.md`, and emits SARIF findings. Runs `agnix` first to collect AGM-* / XP-* / CC-AG-* structural lint, then adds the semantic layer: description quality, tool-whitelist sanity, trigger-overlap detection, and output-contract drift.

Pure leaf: no `Skill()` calls. The omnibus chains us; we report.

## When to use

- User asks to audit their subagent definitions, find dispatch ambiguities, or check agent quality.
- User invokes `/agents-audit`, or the omnibus dispatches the `audit` verb to the `agents` domain.

## When NOT to use

- Full agent-config health check (CLAUDE.md @-includes, MCP, skills, permissions) → `config-audit`.
- Skill-routing problems specifically → `skills-audit`.
- Hook-specific problems → `hooks-audit`.

## Inputs

1. **Scope** (default: `--all`) — every agent file in `src/agents/` and `.claude/agents/`. `--diff` for changed-only; `--module <path>` for a single file.
2. **Threshold** (optional) — confidence floor 0-100; default 80 per `omnibus.yml`.

## Process

### 1. Run agnix structural lint

Before the semantic walk, run agnix against the agents directory to collect structural findings. agnix covers rule families AGM-* (agent metadata), XP-* (cross-platform), and CC-AG-* (Claude Code agent rules):

```bash
agnix --target claude-code --format sarif src/agents/ 2>&1
```

Collect all errors and warnings. Mark fixable ones `[fixable]`. These will be passed through in the SARIF output citing `agnix/AGM-<n>` / `agnix/XP-<n>` / `agnix/CC-AG-<n>` rule IDs — don't re-report them under your own ruleIds.

### 2. Resolve scope

```bash
# --diff
git diff --name-only origin/main...HEAD -- 'src/agents/*.md' '.claude/agents/*.md' '~/.claude/agents/*.md'

# --all (default — small, stable set)
find src/agents .claude/agents ~/.claude/agents -maxdepth 1 -name '*.md' 2>/dev/null
```

### 3. Walk the rules

For each in-scope agent file, evaluate sections A through F in `src/rules/agents/RULES.md`. Concrete checks:

- **A.1 (frontmatter):** parse YAML; flag missing `name` / `description`.
- **A.2 (name matches filename):** `name == basename(file, ".md")`.
- **A.3 (model freshness):** if `model:` is set, confirm it's a current model ID (refresh from CLAUDE.md `Environment` section); flag stale 3.x or unrecognized IDs.
- **B.1 (description quality):** description ≥120 chars; has negative scope ("Do NOT use when…" or equivalent); doesn't collide with sibling descriptions on keyword overlap > ~60%.
- **B.2 (output contract):** description mentions "reports", "returns", "summarizes", or "produces".
- **C.1 (over-privileged):** for agents with read-only verbs ("audit", "review", "report") in their description, flag inclusion of `Edit` / `Write` / `Bash` in `tools:`.
- **C.2 (no Task tool):** flag `Task` (or equivalent agent-spawning tool) in any `tools:` array.
- **D.1 (trigger overlap):** parse all agent descriptions; flag noun-phrase collisions where two agents promise to handle the same request shape.
- **E.1 (output contract drift):** agents with structured-output verbs in body but no contract statement in description.
- **E.2 (capability drift):** description references a tool / skill not in the whitelist or not present as a skill.
- **F.1 (statelessness):** agent body text containing phrases like "as we discussed", "earlier", "previous turn".

### 4. Apply negative-filter list

Per `src/rules/agents/RULES.md` + `src/skills/_shared/finding.md`:

- Style preferences not in `agents/RULES.md` → drop
- Pre-existing issues outside scope → record under "Pre-existing Issues"
- Issues agnix AGM-* / XP-* / CC-AG-* covers → cite agnix's rule, pass through
- Pedantic nitpicks → drop

### 5. Emit SARIF

Single SARIF v2.1.0 run, `tool.driver.name = "agents-audit"`. Each `result`:

```json
{
  "ruleId": "agents/RULES.md#<section>.<n>" | "agnix/AGM-<n>" | "agnix/XP-<n>" | "agnix/CC-AG-<n>",
  "level": "error" | "warning" | "note",
  "message": { "text": "<one-line description>" },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "src/agents/<name>.md" }, "region": { "startLine": N, "endLine": N } } }],
  "properties": {
    "confidence": 0,
    "severity": "blocking" | "important" | "nit" | "suggestion" | "praise",
    "fix": "<concrete change — frontmatter add, tool removal, description rewrite>",
    "tag": "frontmatter" | "naming" | "stale-model" | "description-quality" | "over-privileged" | "r1-violation" | "routing-collision" | "contract-drift" | "agent-drift" | "statelessness",
    "scope": "diff" | "module" | "all"
  }
}
```

`confidence` is provisional; the omnibus validation pass refines it.

Praise candidates: agents that exemplify clear scope (description has explicit "when to use" + "when NOT to use"), minimal tool whitelists, and stated output contracts. Mark `severity: praise`, `tag: defense-in-depth`, with a `fix` like "use as reference for: agent description structure".

### 6. Emit a phased prose summary

```
# Agents Audit — <scope>

## Summary
N agents audited · N missing frontmatter · N over-privileged · N routing-collision pairs

## blocking (N)
- <file:line> — <rule> — <one-line>

## important (N)
- ...

## nit (N)
- ...

## Agent detail

| Agent | Name match | Model | Tools | Scope | When-NOT | Verdict |
|-------|-----------|-------|-------|-------|---------|---------|
| ... | ✓ | sonnet | minimal | clear | ✓ | OK |

### Routing-collision pairs (require disambiguation)
| Agent A | Agent B | Overlap | Suggested |
|---------|---------|---------|-----------|
| ... | ... | "code review" | A: "architectural review only"; B: "diff-line nit review only" |

## Pre-existing issues (out of scope)
- ...
```

## Scope discipline

- **Read-only.** No `Edit`, `Write`, or mutating `Bash`.
- **No `Skill()` calls.** The omnibus chains; we audit.
- **No verification gate.** Audit is non-mutating.
- **Don't duplicate agnix.** Cite AGM-* / XP-* / CC-AG-* rules where they apply.

## Output template

```
[sarif]
{ ... SARIF v2.1.0 ... }
[/sarif]

# Agents Audit — <scope>
<phased prose + detail tables>
```

## Guardrails

- **Confidence is provisional.** Omnibus validation refines it.
- **Cite rules precisely.** `agents/RULES.md#<section>.<n>` or `agnix/AGM-<n>` or `agnix/XP-<n>` or `agnix/CC-AG-<n>`.
- **Routing-collision is the highest-leverage check** — silent wrong-routing is the dominant failure mode for agent setups; flagging early prevents downstream confusion.
- **Over-privileged tool grants and `Task` in `tools:` are blocking-leaning** — security and architecture violations respectively.

## Cross-references

- Rule source: `src/rules/agents/RULES.md`
- Finding contract: `src/skills/_shared/finding.md`
- Architecture: `docs/plans/skill-architecture.md` (R1 — applied to agents)
- Broader audit: `src/skills/config-audit/SKILL.md` (agents + skills + hooks + CLAUDE.md + MCP)
- Orchestrator: `src/skills/omnibus/SKILL.md`
