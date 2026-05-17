# Config Rules

Authoritative rules for Claude Code agent configuration: `CLAUDE.md` files, `.claude/settings.json`, hook registries, MCP server configs, `AGENTS.md`. Read by `src/skills/config-audit/SKILL.md`.

There is no `config-fix` or `config-author` skill — config writes are schema-driven and infrequent (agnix territory). Audit-only domain. Most structural lint is delegated to `agnix --dry-run`; `config-audit` adds the semantic layer (output tracing, dead output detection, cross-file integrity) that agnix doesn't cover.

Every rule is **checkable**: it can be evaluated against a real project tree and produce a SARIF finding (per `src/skills/_shared/finding.md`). Where agnix already covers a rule, the finding's `ruleId` cites the agnix rule directly (`agnix/CC-SK-12`); this domain's rules cover what agnix doesn't.

Scope: project root, `.claude/`, `~/.claude/`, `src/core/hooks/settings-hooks.json`, every `CLAUDE.md` and `AGENTS.md` reachable from the project.

---

## A. CLAUDE.md @-includes

*Sources: Claude Code @-include resolution; arch §3 R5 reference-loading model.*

### A.1 Every `@`-include resolves to a real file

`CLAUDE.md` files load referenced rule files via `@path/to/file.md`. Broken paths silently omit rules — no error, no log, just missing context.

- **Detect:** for each `@`-prefixed line in any reachable `CLAUDE.md`, resolve the path relative to the include's source root; flag if the target doesn't exist
- **Severity:** `important`
- **Tag:** `broken-include`

### A.2 No circular `@`-includes

`@`-include cycles cause undefined load behavior. The graph of includes must be a DAG.

- **Detect:** walk the include graph; flag any cycle
- **Severity:** `important`
- **Tag:** `broken-include`

### A.3 No duplicate rule content across CLAUDE.md layers

The same instruction must not appear in both global (`~/.claude/CLAUDE.md`) and project (`.claude/CLAUDE.md`) — Claude Code merges them and the duplicate fires/loads twice. The Construct project's "CLAUDE.md ownership" doc table defines authoritative locations.

- **Detect:** identical paragraph-level content between layers; or both files defining rules for the same domain (e.g., both have a "Testing Philosophy" section)
- **Severity:** `important`
- **Tag:** `duplicate-rule`

---

## B. Hook registry consistency

*Sources: `src/core/hooks/settings-hooks.json`, Construct CLAUDE.md "Avoiding duplication".*

### B.1 Every hook command points at a file that exists

Hook entries in `settings-hooks.json` reference a script. If the script doesn't exist, the hook silently fires nothing.

- **Detect:** for each hook entry, resolve the `command` path relative to the registry; flag if the target doesn't exist
- **Severity:** `blocking`
- **Tag:** `dead-hook`

### B.2 No double registration in `.claude/settings.json` and `src/core/hooks/`

Hooks declared in both `.claude/settings.json` and `src/core/hooks/settings-hooks.json` fire twice per event. The Construct CLAUDE.md says hooks belong in `src/core/hooks/`, not `.claude/settings.json`.

- **Detect:** the same hook command path appears in both `.claude/settings.json.hooks` and `src/core/hooks/settings-hooks.json`
- **Severity:** `important`
- **Tag:** `double-fire`

### B.3 Hook outputs have at least one consumer

A hook that writes to `signals/<file>.jsonl` or similar but has no reader anywhere in the codebase is dead output — load-bearing maintenance burden with no payoff.

- **Detect:** for each `writeFileSync`/`appendFileSync`/`reportHook` target in a hook script, grep `src/` for a reader; flag if zero
- **Severity:** `important`
- **Tag:** `dead-output`

### B.4 Hooks handle malformed stdin

Every hook reads from stdin. If `JSON.parse` is unwrapped or unguarded, malformed input crashes the hook silently (exit code escapes to Claude Code).

- **Detect:** hooks reading `await Bun.stdin.text()` without surrounding try/catch + non-zero exit on parse failure
- **Severity:** `important`
- **Tag:** `silent-fail`

### B.5 Hooks use `trace()` for observability

Construct hooks must call `trace()` (from `src/trace.ts`) at completion so observability captures the event. Hooks that skip tracing become invisible to the UI / eval harness.

- **Detect:** hook scripts under `src/core/hooks/` with no `trace(` call
- **Severity:** `nit`
- **Tag:** `observability`

---

## C. Skill registry consistency

*Sources: `src/skills/skill-rules.json`, `src/skills/INSTALL.md`, agnix CC-SK-* rules.*

### C.1 Every `skill-rules.json` entry has a SKILL.md

A registry entry whose target SKILL.md doesn't exist routes keywords to nothing.

- **Detect:** for each `{ skill: <name> }` entry in `src/skills/skill-rules.json`, confirm `src/skills/<name>/SKILL.md` exists
- **Severity:** `blocking`
- **Tag:** `dead-skill`

### C.2 Every SKILL.md has a registry entry

A SKILL.md without a registry entry loads but never triggers via keyword routing — only by explicit `/<name>` invocation or another skill calling it. For audit/fix leaves this is acceptable (the omnibus dispatches them); for user-facing skills it's a discoverability bug.

- **Detect:** for each `src/skills/<name>/SKILL.md`, confirm `skill-rules.json` has an entry — or that the skill is explicitly marked omnibus-only
- **Severity:** `nit`
- **Tag:** `orphaned-skill`

### C.3 `name:` frontmatter matches the directory

A SKILL.md's `name:` field must equal the directory name. Mismatches confuse the registry and break omnibus dispatch.

- **Detect:** for each `src/skills/<dir>/SKILL.md`, parse YAML frontmatter and confirm `name == <dir>`
- **Severity:** `important`
- **Tag:** `naming`

### C.4 No two registry entries route the same keyword

Keyword collisions in `skill-rules.json` make routing nondeterministic — the first match wins, but which match is "first" depends on file order. Keywords should partition cleanly.

- **Detect:** parse all `keywords:` arrays; flag any literal keyword that appears in two or more entries (regex keywords are excluded — they're allowed to overlap deliberately)
- **Severity:** `important`
- **Tag:** `routing-collision`

---

## D. MCP config

*Sources: `.claude/settings.json` MCP block, agnix MCP-* rules.*

### D.1 MCP `command` paths resolve

For each MCP server in `.claude/settings.json` `mcpServers`, the `command` field must point at an executable that exists on PATH or at an absolute path that resolves.

- **Detect:** for each `mcpServers.<name>.command`, run `which <cmd>` or `test -x <path>`; flag failures
- **Severity:** `important`
- **Tag:** `dead-mcp`

### D.2 MCP servers don't ship secrets in `args`

Command-line `args` for MCP servers must not include literal API keys, OAuth secrets, or tokens. Use env vars instead (the `env` field).

- **Detect:** `mcpServers.<name>.args` arrays containing strings matching secret patterns (same as `security/RULES.md#C.1`)
- **Severity:** `blocking`
- **Tag:** `secret`

---

## E. Permission hygiene

*Sources: `.claude/settings.json` `permissions` block, global CLAUDE.md "Permissions".*

### E.1 No `Bash(*)` unrestricted allowlists

`.claude/settings.json` `permissions.allow` entries must not contain `Bash(*)` or equivalent unrestricted patterns — defeats the permission model.

- **Detect:** `permissions.allow` entries matching `Bash\(\*\)` or `Bash\(.*\*.*\)`
- **Severity:** `important`
- **Tag:** `overbroad-permission`

### E.2 Each permission has a discoverable rationale

For Construct projects: every entry in `permissions.allow` should be one a `fewer-permission-prompts` analysis would justify. Pre-existing entries with no justification are flagged for review.

- **Detect:** entries in `.claude/settings.json` `permissions.allow` added in the current diff with no accompanying comment or commit message context
- **Severity:** `nit`
- **Tag:** `permission-review`

---

## F. AGENTS.md / agent definitions

*Sources: `src/agents/*.md`, agnix AGM-* and XP-* rules.*

### F.1 Every agent referenced in code exists as a file

If `src/skills/<x>/SKILL.md` or some hook references an agent name (e.g., `~/.claude/agents/<name>.md`), the file must exist.

- **Detect:** for each agent reference in skill/hook source, confirm the target file exists
- **Severity:** `important`
- **Tag:** `dead-agent`

### F.2 Agent descriptions don't promise capabilities the agent lacks

Agent descriptions in frontmatter should describe what the agent does, not aspirational features. Drift between description and implementation is a UX bug.

- **Detect:** Heuristic — flag agents whose description mentions tools or skills not actually loaded in their prompt
- **Severity:** `nit`
- **Tag:** `agent-drift`

---

## G. agnix passthrough

*Sources: `agnix --dry-run` output; agnix covers 385 rules across CC-*, AS-*/CC-SK-*, AGM-*/XP-*, MCP-*.*

### G.1 Surface agnix findings with native rule IDs

When `config-audit` is invoked and agnix is installed, it runs `agnix --dry-run --show-fixes` and surfaces each finding in the SARIF output. Each finding's `ruleId` is the agnix rule (e.g., `agnix/CC-SK-12`), `severity` is mapped from agnix's error/warning tier, and `properties.fix` carries `agnix --fix-safe` applicability.

- **Detect:** run `agnix --dry-run --show-fixes .`; for each error/warning, emit a finding with `ruleId: agnix/<rule-id>`
- **Severity:** mapped from agnix's tier
- **Tag:** `agnix`

agnix categories (cited as passthrough):

- `agnix/CC-*` — CLAUDE.md, hooks, agents, plugins (53 rules)
- `agnix/AS-*`, `agnix/CC-SK-*` — SKILL.md naming, frontmatter, required fields (31 rules)
- `agnix/AGM-*`, `agnix/XP-*` — AGENTS.md structure (13 rules)
- `agnix/MCP-*` — MCP server config (12 rules)

If agnix is not installed, this rule produces a single `severity: nit` finding noting the missing tool. `config-audit` continues without it.

---

## Negative-filter list (uniform with other audit leaves)

Per `src/skills/_shared/finding.md`:

- Style preferences not in this file → drop
- Pre-existing issues outside scope → record under "Pre-existing Issues" SARIF run
- Issues a linter would catch — cite agnix's native rule ID and pass through
- Pedantic nitpicks → drop
- Lint-ignored lines → drop

---

## Approval policy

Config findings default to `approval: single` per `omnibus.yml` `by_domain.config`. Exceptions:

- `tag: secret` → `per-finding` (matches `by_tag.secret`)
- `tag: overbroad-permission` → `per-finding` (security-adjacent)

The omnibus enforces approval routing.
