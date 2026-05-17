---
name: agent-review
description: >
  Review all AI-runtime config — CLAUDE.md, hooks, skills, agent personas. Audit
  findings (default) or apply approved fixes (mode: fix). Covers four sub-surfaces
  previously split as config/hooks/skills/agents domains. Triggers on /audit agent,
  /fix agent, /agent-review, "audit my config", "audit the agent setup", "audit my
  hooks", "are my hooks wired", "audit my skills", "find orphaned skills", "audit
  my agents", "find agent drift", "check cross-domain drift", "what's broken in my
  setup".
verb: review
domain: agent
modes: [audit, fix]
sub_surfaces:
  - config   # CLAUDE.md, settings.json, .claude/
  - hooks    # src/core/hooks/*.ts, settings-hooks.json
  - skills   # src/skills/*/SKILL.md, skill-rules.json
  - personas # src/agents/*.md
metadata:
  argument-hint: <scope-or-sub-surface> [--mode audit|fix]
---

# Agent Review

Single leaf for all AI-runtime config review. Covers four sub-surfaces:

| Sub-surface | Files | Rules |
|---|---|---|
| config | CLAUDE.md, settings.json, .claude/ | `src/rules/agent/config.md` |
| hooks | `src/core/hooks/*.ts`, `settings-hooks.json` | `src/rules/agent/hooks.md` |
| skills | `src/skills/*/SKILL.md`, `skill-rules.json` | `src/rules/agent/skills.md` |
| personas | `src/agents/*.md`, `.claude/agents/*.md` | `src/rules/agent/personas.md` |

The orchestrator dispatches in `mode: audit` for `/audit agent` (report only) and `mode: fix` for `/fix agent` (apply approved findings). Cross-sub-surface drift checks — skill referenced by an agent persona, hook writer→consumer pairs, skill-rules.json entries vs SKILL.md files on disk, CLAUDE.md `@`-include resolution into skill / hook directories — are first-class findings here. They no longer require Phase 1.5 cross-domain orchestration: a single walk covers every sub-surface, and cross-references are resolved inline.

Pure leaf: no `Skill()` calls. The omnibus chains us; we report (audit) or apply (fix).

## When to use

- User asks to audit / fix any of: CLAUDE.md, hooks, skills, MCP servers, agent personas, the skill registry, hook output tracing, agent dispatch ambiguity, or the overall agent setup.
- User invokes `/agent-review`, `/audit agent`, or `/fix agent`.
- Omnibus dispatches the `review` verb to the `agent` domain.

## When NOT to use

- General TypeScript code quality → `code-review`.
- Visual / UX review → `design-review`.
- Documentation prose → `docs-review`.
- Security vulnerabilities (injection, auth, secrets in code) → `code-review` (walks `src/rules/security/RULES.md`).
- Authoring net-new skills → `skill-creator`.

## Modes

| Mode | Behavior | Verification |
|---|---|---|
| `audit` (default) | Read-only walk; emit SARIF + phased prose report. No edits. | None (non-mutating) |
| `fix` | Parse SARIF input, group by `properties.sub_surface` + `properties.tag`, apply approved edits, re-audit touched files. | `gate("hooks")` + `gate("skills")` + `gate("agents")` + `gate("code")` per touched sub-surface |

The omnibus enforces approval before dispatching `mode: fix`. Per-finding approval is required for: `pii`, `secret`, `over-privileged`, `r1-violation`, `dead-output` (deletion path), and any rename operation. Other findings default to single-approval.

## Inputs

1. **Mode** — `audit` (default) or `fix`.
2. **Scope** — `--diff` (changed files vs `origin/main`), `--module <path>`, or `--all` (default for small surfaces). Optional `--sub-surface config|hooks|skills|personas` to limit which sub-surface gets walked.
3. **Findings** (fix mode only) — SARIF v2.1.0 from a prior audit run.
4. **Reference** — optional drift target (a canonical CLAUDE.md / SKILL.md / agent file the others should align with).
5. **Threshold** — confidence floor 0-100; default 80 per `omnibus.yml`.

## Process

### 1. agnix structural lint (passthrough)

Run first across all in-scope sub-surfaces. agnix covers structural rule families CC-HK-* (hooks), CC-SK-* (skills), CC-AG-* / AGM-* (agents), and XP-* (cross-platform).

```bash
which agnix 2>/dev/null || echo "NOT_INSTALLED"
agnix --target claude-code --format sarif --dry-run .
```

For each error / warning, emit a SARIF finding citing `agnix/<rule-id>`. Map agnix error → `level: error` + `severity: important`; warning → `level: warning` + `severity: nit`. Mark `--fix-safe`-applicable findings with `properties.tag: agnix-autofix`. **Do not duplicate agnix findings under our own ruleIds** — cite agnix and pass through.

If agnix isn't installed, emit one `severity: nit` finding ("agnix not installed; install with `npm install -g agnix` for full structural lint") and continue.

### 2. Resolve scope per sub-surface

```bash
# config
find . -name "CLAUDE.md" -not -path "*/node_modules/*" -not -path "*/.git/*"
# plus .claude/settings.json + ~/.claude/settings.json

# hooks (diff default; fall back to all)
git diff --name-only origin/main...HEAD -- 'src/core/hooks/**/*.ts' 'src/core/hooks/settings-hooks.json' '.claude/settings.json'
# or --all: parse settings-hooks.json + .claude/settings.json hooks array; resolve each `command` field

# skills
find src/skills -name 'SKILL.md'
# plus src/skills/skill-rules.json

# personas
find src/agents .claude/agents ~/.claude/agents -maxdepth 1 -name '*.md' 2>/dev/null
```

Default scope strategy: try `--diff` first per sub-surface; fall back to `--all` (these surfaces are small and stable — auditing all is cheap).

### 3. Walk per-sub-surface rules — see "Sub-surfaces" below

Each sub-surface section enumerates its concrete checks. Findings are tagged with `properties.sub_surface: config|hooks|skills|personas` so the omnibus and fix mode can group them.

### 4. Apply negative-filter list

Per `src/skills/_shared/finding.md` and the per-sub-surface RULES.md:

- Style preferences not in any RULES.md → drop
- Pre-existing issues outside scope → record under "Pre-existing Issues" SARIF run
- Issues agnix already covers → cite the agnix rule (don't duplicate)
- Pedantic nitpicks → drop
- Lint-ignored entries → drop

### 5. Emit SARIF (audit) or apply edits (fix)

**Audit mode:** single SARIF v2.1.0 run, `tool.driver.name = "agent-review"`. See "Output" for shape.

**Fix mode:** group findings by `sub_surface` + `tag`, map each to the fix shapes in the corresponding sub-surface section, plan the edits, apply in the order dictated by the sub-surface's fix discipline, then verify with the gate(s) for every touched sub-surface.

### 6. Emit phased prose summary (audit) or apply-and-verify report (fix)

See "Output".

## Sub-surfaces

### Config

**Rules:** `src/rules/agent/config.md` (sections A-G — CLAUDE.md, hooks-overview, skills-overview, MCP, permissions, statusline, agnix passthrough).

**No predecessor fix skill.** Config writes are schema-driven; structural fixes delegate to `agnix --fix-safe` (auto-applies the safe subset of agnix-detected fixes). In `mode: fix`, the config sub-section:

1. For findings tagged `agnix-autofix`: prompt the user "Apply `agnix --fix-safe .`?" and execute on approval.
2. For content-level findings (broken `@`-includes, duplicate-rule blocks across CLAUDE.md layers, dead-MCP `command` fields, overbroad-permission entries, secrets in `mcpServers.args`): apply the literal `properties.fix` value as an Edit.
3. Structural lint (frontmatter parse, JSON validity, file existence) is **always** agnix's job — never re-implement.

**Concrete audit checks** (cites `agent/config.md`):

- **CLAUDE.md `@`-include integrity (§A.1):** find every `@`-prefixed include in every CLAUDE.md file; verify each path resolves. A broken include silently omits rules — Claude never loads them and gives no error. `tag: broken-include`, `severity: important`.
- **CLAUDE.md include-graph cycles (§A.2):** walk the include graph; flag any cycle.
- **CLAUDE.md duplicate rules (§A.3):** flag duplicated rule blocks across CLAUDE.md layers. `tag: duplicate-rule`.
- **Hook registry double-fire (§B.2):** for each hook command path, check whether it appears in both `.claude/settings.json` AND `src/core/hooks/settings-hooks.json`. `tag: double-fire`, `severity: important`. (Per Construct CLAUDE.md "Avoiding duplication": keep in `src/`, remove from `.claude/`.)
- **MCP dead command (§D.1):** for each `mcpServers.<name>.command`, verify the executable resolves. `tag: dead-mcp`.
- **MCP secrets in args (§D.2):** scan `mcpServers.<name>.args` for literal secrets / API keys. `tag: secret`, `severity: blocking`.
- **Overbroad permissions (§E.1):** flag `Bash(*)` or equivalent unrestricted patterns in `permissions.allow`. `tag: overbroad-permission`.

**Fix shapes:**

| Tag | Fix shape |
|---|---|
| `agnix-autofix` | Run `agnix --fix-safe .` after explicit user approval |
| `broken-include` | Either restore the missing file or remove the `@<path>` reference |
| `duplicate-rule` | Remove the duplicate from the lower-precedence layer per the CLAUDE.md ownership table |
| `double-fire` | Remove the hook from `.claude/settings.json`; keep in `src/core/hooks/settings-hooks.json` |
| `dead-mcp` | Either install the missing command or remove the MCP server entry |
| `secret` | Move the secret to an env var; reference it in args via `${ENV_VAR}` |
| `overbroad-permission` | Narrow the pattern (e.g., `Bash(*)` → `Bash(bun:*)` `Bash(git:*)`) |

### Hooks

**Rules:** `src/rules/agent/hooks.md` (sections A-I — stdin safety, tracing, exit codes, stdout/stderr, file outputs, pair contracts, registration integrity, silent-fail prevention, telemetry-backed unused-hook detection).

**Concrete audit checks:**

- **A.1 (stdin try/catch):** find `JSON.parse(await Bun.stdin.text())` and verify it's wrapped in try/catch with a non-zero exit in the catch path.
- **B.1 (trace call):** confirm `trace(` from `src/trace.ts` appears at least once before every `process.exit` path.
- **C.1 (explicit exit):** flag hook scripts whose top-level main path doesn't call `process.exit(...)` explicitly.
- **C.2/C.3 (exit code values + PreToolUse only):** confirm `process.exit(N)` uses `N ∈ {0, 1, 2}` and `exit(2)` only appears on PreToolUse-registered hooks.
- **D.1 (stdout slop):** flag `console.log('')` and similar empty writes.
- **D.2 (stderr on non-zero exit):** flag `process.exit(1|2)` calls without a preceding `console.error` / `process.stderr.write`.
- **E.1 (dead outputs):** for each `writeFileSync` / `appendFileSync` / `reportHook` target, grep `src/` for a consumer; flag if zero. `tag: dead-output`, `severity: important`.
- **E.3 (PII / secrets in outputs):** scan written payloads for `password|token|apiKey|secret|authorization`; cross-reference `security/RULES.md#C.1` patterns.
- **F.1 (untyped pair contracts):** identify writer-reader hook pairs (PreCompact→SessionStart snapshot; Stop→SessionStart session-file; UserPromptSubmit→Stop directives) and check for shared type imports / schema files.
- **G.1 (dead hook registration):** for each entry in the registries, confirm the script file exists. `tag: dead-hook`, `severity: blocking`.
- **G.2 (event/matcher uniqueness):** flag duplicate `(event, matcher)` pairs.
- **G.3 (cross-registry double registration):** same as Config §B.2 (cross-tagged for both sub-surfaces; emit once).
- **H.1 (silent catch):** flag catch blocks without log / exit / re-throw.
- **I.1 (unused-hook):** for each registered hook, `grep "\"hook\":\"<name>\"" ~/.construct/signals/hook-events.jsonl | wc -l`; zero hits AND creation > 5 sessions ago (git log) = `suggestion` `unused-hook`. Include the registered event type so the reader knows what was expected to trigger it.
- **I.2 (writer fires, reader never does):** for each writer-reader pair identified in F.1, check `hook-events.jsonl` for the writer's entries; if writer entries exist but the reader's name never appears in subsequent entries within the same `sessionId`, flag as `important` `dead-output`.

**Hook verdict per script:**

- **LIVE** — all file outputs have confirmed consumers.
- **PARTIAL** — some outputs consumed, some orphaned.
- **DEAD** — files written but nothing reads them → emit finding.
- **ADVISORY** — stdout/stderr only, no file outputs (correct for advisory hooks).
- **BROKEN** — script file missing → emit finding.

**Fix shapes** (`mode: fix` for tag → edit):

| Tag | Fix shape |
|---|---|
| `silent-fail` (stdin parse) | Wrap `JSON.parse(...)` in try/catch; catch writes to stderr + `process.exit(1)` |
| `silent-fail` (catch block) | Add `console.error(...)` + `process.exit(1)` (or `trace({error})` + exit) |
| `silent-fail` (mkdir) | Insert `mkdirSync(dirname(path), { recursive: true })` before the `writeFileSync` |
| `silent-fail` (non-zero exit w/o stderr) | Insert `console.error(...)` before `process.exit(1|2)` |
| `observability` (no trace) | Add `trace({ event, sessionId, ...detail })` before every exit path |
| `observability` (incomplete trace) | Update existing `trace(...)` to include `event` (+ `sessionId` where available) |
| `correctness` (exit code) | Replace `process.exit(N)` with valid code |
| `correctness` (exit(2) wrong event) | If hook is not PreToolUse, change `exit(2)` → `exit(1)` |
| `slop` (empty stdout) | Remove `console.log('')` / `process.stdout.write('')` |
| `dead-output` | Per-finding decision: add consumer OR remove the write call |
| `pii` (logged payload) | Add redaction helper; drop fields matching `password|token|apiKey|secret|authorization`. Drop, don't partially-mask |
| `pair-contract` (untyped) | Add a co-located `types.ts`; writer + reader both import |
| `pair-contract` (undocumented) | Brief comment on both call sites referencing the pair |
| `dead-hook` | Restore script OR remove registration |
| `double-fire` (cross-registry) | Remove from `.claude/settings.json`; keep in `src/core/hooks/settings-hooks.json` |

**Fix order:** stdin-safety wrappers → trace() additions → exit-code corrections → output / pair-contract changes → registry edits (validate JSON after each) → cross-file pair updates.

**Verification:** `gate("hooks")` + `agent-review --sub-surface hooks --module <touched>` (re-audit) + `gate("code")` + `JSON.parse` on both registries.

### Skills

**Rules:** `src/rules/agent/skills.md` (sections A-H — frontmatter, description quality, registry consistency, progressive disclosure, architecture purity, gate discipline, trigger alignment, telemetry-backed trigger health).

**Concrete audit checks:**

- **A.1-A.4 (frontmatter):** parse YAML; confirm `name` + `description`; for audit/fix skills also `verb` / `domain` / `modes`; flag values outside the recognized verb / domain sets.
- **A.2 (name matches dir):** `name == basename(dirname(path))`.
- **B.1-B.2 (description quality):** ≥100 chars; mentions concrete trigger phrases (quoted or `/<slash>`); covers scope vs sibling skills.
- **C.1 (orphaned):** for each SKILL.md, confirm `skill-rules.json` has an entry — unless the skill is an audit/fix leaf (omnibus dispatches by name) or explicitly omnibus-only.
- **C.2 (duplicate keywords):** parse all `keywords` arrays; flag literal keywords appearing in 2+ entries.
- **D.1 (slim SKILL.md):** flag files longer than 250 lines (detail moves to `references/`).
- **D.2 (examples):** skills with slash-commands should have at least one `examples/<case>.md`.
- **E.1 (R1 — no Skill() from leaves):** grep `Skill(` in every SKILL.md outside `omnibus/SKILL.md`; allow only prose negations; flag actual invocations. `severity: blocking`-leaning.
- **E.2 (R2 — no inline skill chaining):** flag prose like "invoke `<sibling-skill>`" outside omnibus-dispatch context.
- **F.1 (R4 — no hardcoded gates):** in fix-flavor SKILL.md files, flag literal `bun test.ts` / `bun run ui:smoke` / `agnix --dry-run` outside Cross-references / example blocks.
- **G.1 (trigger drift):** parse description, extract quoted trigger phrases, confirm each appears in the corresponding `skill-rules.json` entry's keyword list.
- **G.2 (transcript-backed trigger health, scope=all only):** see full procedure below.
- **H.1 (unused-skill):** all four conditions — no `examples/`, description < 150 chars, zero git commits in last 30 days, creation > 30 days ago — together = `suggestion` `unused-skill`.
- **H.2 (dead-reference):** parse skill body for `subagent_type: "<name>"` and hook script name references; grep `src/agents/`, `~/.claude/agents/`, and the hook registry; flag missing as `important` `dead-reference`.

**G.2 — Transcript-backed trigger analysis (runs during scope=all audits):**

**Step 1 — Extract recent user messages:**

```python
import json, glob, os
project_dir = os.path.expanduser("~/.claude/projects/-home-crsmi-construct")
files = sorted(glob.glob(f"{project_dir}/*.jsonl"), key=os.path.getmtime, reverse=True)[:30]
msgs = []
for f in files:
    for line in open(f):
        d = json.loads(line)
        if d.get("type") == "user":
            content = d.get("message", {}).get("content", "")
            if isinstance(content, str) and content.strip() and not content.startswith("<"):
                msgs.append(content[:400])
            elif isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get("type") == "text" and not c["text"].startswith("<"):
                        msgs.append(c["text"][:400])
```

**Step 2 — Classify each message:** does it match any skill's keyword list (literal or regex)? does it start with a slash command? did it appear to trigger a skill (look at surrounding assistant messages for skill-invocation patterns)?

**Step 3 — Per-skill stats:** `slash_count`, `keyword_match_count`, `triggered_count`, `missed_count`.

**Step 4 — Flag findings:**

- **`trigger-stale`** (suggestion, confidence 70): keyword triggers, zero NL matches across ≥20 user messages — include the 3 closest near-matches and suggested additions.
- **`slash-only`** (suggestion, confidence 65): only ever invoked via `/command` — review for intentionality.
- **`missed-trigger`** (suggestion, confidence 75): user phrase clearly maps to skill semantics but no keyword matched. Suggested trigger comes from actual transcript text.
- **`over-broad-trigger`** (nit, confidence 65): keyword is a common English word/phrase (≤3 tokens) — flag for specificity review.

**G.2 guardrails:**
- Only flag `slash-only` when there are ≥5 invocations and 0 keyword matches.
- Don't flag `trigger-stale` when keyword triggers are slash-only by design (e.g., `eval-harness` is always `/eval`).
- Suggested phrases must come from actual transcript text — no invented generic suggestions.

**Eval-target marker preservation:** when fixing skills, preserve any frontmatter `eval-target:` markers and `evals/<name>.yml` references — the eval-harness reads these and breaks silently if renamed.

**Fix shapes:**

| Tag | Fix shape |
|---|---|
| `frontmatter` | Add missing `name` / `description` / `verb` / `domain` / `modes` |
| `naming` | Rename directory to match `name:` OR update `name:` to match dir (per-finding decision) |
| `correctness` (verb/domain) | Update to one of the architecture-recognized values |
| `description-quality` | Apply the rewritten description from `properties.fix`; ≥100 chars, concrete triggers, scope vs siblings |
| `orphaned-skill` | Add a `skill-rules.json` entry with keywords derived from description |
| `routing-collision` | Remove the duplicate keyword from the lower-priority entry; add a more specific one |
| `slop` (length) | Move detail to `references/<topic>.md`; SKILL.md keeps cross-reference |
| `examples` | Create `examples/<case>.md` with a worked invocation |
| `r1-violation` | Replace `Skill('<x>')` with a tagged-finding emission; let omnibus route |
| `r2-violation` | Replace "invoke `<sibling>`" prose with a file reference (`references/<shared-process>.md`) |
| `r4-violation` | Replace hardcoded `bun test.ts` / `bun run ui:smoke` with `gate("<domain>")`; verify `VERIFICATION.md` resolution exists |
| `trigger-drift` | Add the missing trigger phrases to the `skill-rules.json` entry's `keywords` array |

**Fix order:** SKILL.md frontmatter → body edits (R1/R2/R4) → `skill-rules.json` edits (validate JSON after each) → file ops (`git mv` for renames, `examples/` / `references/` creation) → cross-reference updates.

**Hard rules:**
- Don't rename skills without explicit per-finding approval (breaks downstream registry entries / callers).
- Don't add registry entries for omnibus-only leaves (`-audit` / `-fix` and now `agent-review` itself) unless explicitly requested.
- No leftover trigger phrases or orphan example files (Commandment 7).

**Verification:** `gate("skills")` + `JSON.parse(skill-rules.json)` + re-grep `Skill(` (only prose negations remain) + `agnix --dry-run` (if installed).

### Personas

**Rules:** `src/rules/agent/personas.md` (sections A-G — frontmatter, description quality + output contract, tool whitelist, trigger overlap, contract / capability / statelessness drift, cross-domain consistency).

**Concrete audit checks:**

- **A.1 (frontmatter):** parse YAML; flag missing `name` / `description`.
- **A.2 (name matches filename):** `name == basename(file, ".md")`.
- **A.3 (model freshness):** if `model:` is set, confirm it's a current model ID; flag stale 3.x or unrecognized IDs.
- **B.1 (description quality):** ≥120 chars; has negative scope ("Do NOT use when…"); doesn't collide with sibling descriptions on keyword overlap > ~60%.
- **B.2 (output contract):** description mentions "reports", "returns", "summarizes", or "produces".
- **C.1 (over-privileged):** for agents with read-only verbs in their description, flag inclusion of `Edit` / `Write` / `Bash` in `tools:`.
- **C.2 (no Task tool):** flag `Task` (or equivalent agent-spawning tool) in any `tools:` array — R1 applied to agents.
- **D.1 (trigger overlap):** parse all agent descriptions; flag noun-phrase collisions where two agents promise to handle the same request shape. `tag: routing-collision`.
- **E.1 (output-contract drift):** agents with structured-output verbs in body but no contract statement in description.
- **E.2 (capability drift):** description references a tool / skill not in the whitelist or not present as a skill.
- **F.1 (statelessness):** body text containing "as we discussed", "earlier", "previous turn".
- **G.1 (cross-domain — dead skill reference):** extract all `subagent_type: "<name>"`, `/<name>` slash refs, and prose "X skill" mentions; for each, confirm `src/skills/<name>/SKILL.md` exists and `skill-rules.json` has an entry. `tag: cross-domain-drift`.
- **G.2 (cross-domain — stale after skill change):** for each resolved skill reference, `git log --oneline -10 -- src/skills/<name>/SKILL.md`; if recent commits, emit `suggestion` `cross-domain-drift` ("Skill `<name>` changed recently; verify agent dispatch description is current").
- **G.3 (unused-agent):** grep `src/skills/`, `src/core/hooks/`, and `.claude/` for the agent's name as a `subagent_type` value or explicit dispatch target; zero hits AND > 30 days in repo = `suggestion` `unused-agent`.

**Fix shapes:**

| Tag | Fix shape |
|---|---|
| `frontmatter` | Add missing `name:` / `description:`; add `tools:` / `model:` only when not inheritable |
| `naming` | Rename file to match `name:` OR update `name:` to match filename (per-finding) |
| `stale-model` | Update `model:` to current Claude model ID (refresh from `~/.claude/CLAUDE.md` Environment) |
| `description-quality` (length / scope) | Apply rewrite from `properties.fix`. Required: ≥120 chars; "Use when X. Do NOT use when Y (use `<other-agent>`)"; output contract |
| `description-quality` (output contract) | Add a sentence naming what the parent can expect back |
| `over-privileged` | Remove `Edit` / `Write` / `Bash` from `tools:` for read-only agents — **per-finding approval** |
| `r1-violation` (Task tool) | Remove `Task` from `tools:`. Subagents cannot spawn subagents — **per-finding approval** |
| `routing-collision` | Apply the suggested rewrite; typical: add a distinguishing modifier or merge if truly duplicate |
| `contract-drift` | Add the output-contract statement to description; if body promises unimplemented output, surface as a `code-review` finding (don't auto-edit body logic) |
| `agent-drift` (capability mismatch) | Add the missing tool (with security review) or remove the reference; per-finding |
| `statelessness` | Remove "as we discussed" / "earlier" / "your previous response" from body |
| `cross-domain-drift` (dead-skill-ref) | Either update the reference to the renamed skill, or author the missing skill, or remove the reference — per-finding |
| `unused-agent` | Either dispatch the agent from a skill / hook, or delete the agent file — per-finding |

**Fix order:** frontmatter → description rewrites → tool whitelist edits → body edits (statelessness) → renames (`git mv` + cross-reference sweep) last.

**Hard rules:**
- Over-privileged removal needs per-finding approval (removing `Edit` might break a workflow).
- Renames need per-finding approval (invalidates references in skills / hooks / docs).
- Routing-collision rewrites are creative work — surface the proposed rewrite, accept the user's revision.

**Verification:** `gate("agents")` (frontmatter parse + agnix AGM-* still green) + `agent-review --sub-surface personas --module <touched>` (re-audit) + cross-reference scan for renamed agents + `gate("code")`.

## Output

### Audit mode

```
[sarif]
{ ... SARIF v2.1.0, tool.driver.name = "agent-review" ... }
[/sarif]

# Agent Review — <scope>

## Summary
agnix: N errors, N warnings (N auto-fixable)
Config: N CLAUDE.md refs broken · N duplicate rules · N MCP issues · N overbroad permissions
Hooks: N live · N partial · N dead · N broken · pairs: N typed / N untyped
Skills: N orphaned · N missing examples · N over-length · keyword collisions: N · R1: N · R4: N
  Trigger health: N stale · N slash-only · N missed · N over-broad
Personas: N missing frontmatter · N over-privileged · N routing-collision pairs · N cross-domain-drift · N unused

## blocking (N)
- <file:line> — <rule> — <one-line> (confidence X) [sub_surface: <s>]

## important (N)
- ...

## nit (N)
- ...

## Config detail
| File | @-includes | Cycles | Duplicates | Verdict |
|------|-----------|--------|------------|---------|
| ... | ... | ... | ... | OK / drift |

## Hook detail
| Hook | Event | Files written | Consumed by | trace() | Verdict |
|------|-------|---------------|-------------|---------|---------|
| ... | ... | ... | ... | ✓/✗ | LIVE / PARTIAL / DEAD / BROKEN / ADVISORY |

### Hook pairs
| Writer | Reader | Shared file | Handoff | Typed? |
|--------|--------|-------------|---------|--------|
| ... | ... | ... | ... | ✓/✗ |

## Skills detail
| Skill | Frontmatter | Registry | Name match | Length | Examples | R1 | Verdict |
|-------|-------------|----------|------------|--------|----------|----|---------|
| ... | ✓ | ✓ | ✓ | 178L | ✓ | ✓ | OK |

### Trigger Health — <N> messages sampled
| Skill | Slash-only | NL-matched | Missed | Verdict |
|-------|-----------|------------|--------|---------|

## Persona detail
| Agent | Name match | Model | Tools | Scope | When-NOT | Verdict |
|-------|-----------|-------|-------|-------|---------|---------|
| ... | ✓ | sonnet | minimal | clear | ✓ | OK |

### Routing-collision pairs (require disambiguation)
| Agent A | Agent B | Overlap | Suggested |

## Pre-existing issues (out of scope)
- ...
```

After presenting, prompt: *"Want me to apply agnix auto-fixes (`agnix --fix-safe .`) or address any of these manually?"*

### SARIF result shape

```json
{
  "ruleId": "agent/<sub_surface>.md#<section>.<n>" | "agnix/<rule-id>",
  "level": "error" | "warning" | "note",
  "message": { "text": "<one-line description>" },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "..." }, "region": { "startLine": N, "endLine": N } } }],
  "properties": {
    "confidence": 0,
    "severity": "blocking" | "important" | "nit" | "suggestion" | "praise",
    "fix": "<concrete remediation>",
    "tag": "<one of the tag values listed in the sub-surface sections>",
    "sub_surface": "config" | "hooks" | "skills" | "personas",
    "scope": "diff" | "module" | "all"
  }
}
```

`confidence` is provisional; the omnibus validation pass refines it.

**Praise candidates:** hooks with try/catch + trace + every output consumed; SKILL.md files exemplifying the leaf contract (slim, scoped, cite RULES.md, registry alignment); agents with explicit when-to + when-NOT + output contract; CLAUDE.md files with clean `@`-include graphs. Mark `severity: praise`, `tag: defense-in-depth`.

### Fix mode

```
[plan]
... edit list, grouped by sub_surface then file ...
[/plan]

[applying]
... per-edit lines, including per-finding re-check ...
[/applying]

[verify]
scope:      <files edited, grouped by sub_surface>
method:     gate("hooks") + gate("skills") + gate("agents") + gate("code") (per touched sub-surface)
            + agent-review --sub-surface <s> --module <touched> (re-audit)
            + JSON.parse on registries + grep Skill( + agnix --dry-run
assertions: zero remaining agent-review findings in scope (per sub-surface); all gates green; registries valid JSON
[/verify]

# Summary
- <N> findings resolved (per sub-surface)
- <M> files edited
- <K> findings skipped (with reasons)
```

## Scope discipline

- **Audit mode is read-only.** No `Edit`, `Write`, or mutating `Bash`. Bash for `which`, `find`, `grep`, `agnix --dry-run`, JSON parsing, `git log` only.
- **Fix mode applies only approved findings.** Per-finding approval required for `pii`, `secret`, `over-privileged`, `r1-violation`, `dead-output` (delete path), and renames.
- **No `Skill()` calls.** The omnibus chains.
- **Don't duplicate agnix.** Cite agnix rule IDs and pass through.
- **Eval-target markers preserved.** Skill `eval-target:` frontmatter and `evals/<name>.yml` references must not be renamed by any fix shape — the eval-harness reads these silently.
- **CLAUDE.md `@`-include resolution is highest-leverage in config sub-surface.** Broken includes silently omit rules.
- **Hook output tracing is highest-leverage in hooks sub-surface.** Dead outputs become load-bearing maintenance burden.
- **R1 violations are highest-leverage in skills sub-surface.** Leaf skills calling `Skill()` undermine the architecture.
- **Routing-collision is highest-leverage in personas sub-surface.** Silent wrong-routing is the dominant failure mode for agent setups.

## Guardrails

- **Verification is non-negotiable in fix mode.** All gates for every touched sub-surface must show in the turn's tool output. Per `~/.claude/CLAUDE.md` "Verification" section: see it work; then say it works.
- **Confidence is provisional.** Omnibus validation refines it.
- **Cite rules precisely.** Every finding includes `agent/<sub_surface>.md#<section>.<n>` or `agnix/<rule-id>`. No bare prose accusations.
- **No scope creep.** Adjacent issues become new findings.
- **JSON edits validate immediately.** Never leave `settings.json` / `settings-hooks.json` / `skill-rules.json` in an invalid state between Edit calls.
- **Removed code goes completely** (Commandment 7): no `// removed` markers, no orphan registry entries, no leftover trigger phrases, no stale cross-references after renames.

## Cross-references

- Rule sources: `src/rules/agent/config.md`, `src/rules/agent/hooks.md`, `src/rules/agent/skills.md`, `src/rules/agent/personas.md`
- Finding contract: `src/skills/_shared/finding.md`
- Orchestrator: `src/skills/omnibus/SKILL.md`
- Verification gates: `VERIFICATION.md`
- Trace helper: `src/trace.ts`
- Architecture: `docs/plans/skill-architecture.md` (R1, R2, R4)
- Sibling review leaves: `code-review`, `design-review`, `docs-review`
- agnix project: https://github.com/agnix-rules/agnix (structural rules for CLAUDE.md / hooks / agents / MCP / skills)
