# Phase 2 — Claude Code plugin packaging

Working doc for Phase 2 of `docs/plans/construct-public-face.md`. Holds the plugin-format reference (task #1), the component mapping (task #2), and the decisions made along the way.

---

## 1. Plugin-format reference

Distilled from `code.claude.com/docs/en/plugins` and `.../plugins-reference`. Fetched 2026-05-18.

### Manifest

- **Path:** `.claude-plugin/plugin.json` at plugin root
- **Required field:** `name` only (kebab-case, no spaces). Drives the namespace prefix for components.
- **Optional fields:** `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `dependencies`, plus component path overrides (see Layout)
- **Version semantics:**
  - Set `"version": "x.y.z"` → users only receive updates when this field bumps
  - Omit `version` → git commit SHA is used; every commit counts as a new version
  - Pick semver for stable releases; pick SHA for rapid iteration

### Layout

All component directories live at the **plugin root**, not inside `.claude-plugin/`. Only `plugin.json` lives in `.claude-plugin/`.

| Slot | Default location | Notes |
|---|---|---|
| Manifest | `.claude-plugin/plugin.json` | Only required if you need metadata or non-default paths |
| Skills | `skills/<name>/SKILL.md` | Preferred. Plus optional `reference.md`, `scripts/` |
| Commands | `commands/*.md` | Flat-file form, kept for back-compat — use `skills/` for new |
| Agents | `agents/*.md` | Frontmatter: `name`, `description`, `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `skills`, `memory`, `background`, `isolation`. **No `hooks`, `mcpServers`, or `permissionMode`.** |
| Hooks | `hooks/hooks.json` | Same JSON shape as `settings.json` `hooks` block |
| MCP servers | `.mcp.json` | Standard MCP `mcpServers` shape |
| LSP servers | `.lsp.json` | Per-language config |
| Monitors | `monitors/monitors.json` | Background watchers, stdout lines → notifications. Experimental |
| Themes | `themes/*.json` | Experimental |
| Output styles | `output-styles/*.md` | — |
| Executables | `bin/<binary>` | Added to Bash tool's PATH while plugin is enabled |
| Default settings | `settings.json` | Only `agent` and `subagentStatusLine` keys honored |

### Namespacing

**Plugin skills are always namespaced.** A plugin named `construct` with a `research` skill is invoked as `/construct:research`, not `/research`. This is a behavior change vs. installing via `bun install.ts` and matters for the README rewrite.

### Path rules

- All paths must be relative to plugin root and start with `./`
- **Plugins cannot reference files outside their directory.** Symlinks resolving inside the plugin are preserved; symlinks resolving elsewhere in the same marketplace are dereferenced (target content copied in); symlinks outside the marketplace are skipped for security.
- Marketplace-installed plugins are **copied** to `~/.claude/plugins/cache/`. They don't run in-place. `${CLAUDE_PLUGIN_ROOT}` points at the cache copy, and changes on update.

### Runtime variables

| Variable | Resolves to | When to use |
|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | Absolute path to plugin's install dir (ephemeral — changes on update) | Reference scripts/binaries bundled with the plugin. Do NOT write state here. |
| `${CLAUDE_PLUGIN_DATA}` | `~/.claude/plugins/data/<id>/` — persists across updates | Installed deps (`node_modules`, venvs), caches, generated code |
| `${CLAUDE_PROJECT_DIR}` | Project root where Claude Code was launched | Reference project-local scripts |

All three are substituted in skill content, agent content, hook commands, monitor commands, MCP/LSP configs, and exported as env vars to hook/MCP/LSP subprocesses.

### Install paths

```bash
# Marketplace install
claude plugin install construct@<marketplace>          # user scope (default)
claude plugin install construct@<marketplace> --scope project
claude plugin install construct@<marketplace> --scope local

# Local dev
claude --plugin-dir ./construct
claude --plugin-dir ./construct.zip                    # v2.1.128+

# Remote zip (try-before-install)
claude --plugin-url https://example.com/construct.zip

# Reload after edits
/reload-plugins

# Validate
claude plugin validate
```

### Install scopes

| Scope | Settings file | Use |
|---|---|---|
| `user` | `~/.claude/settings.json` | Personal, default |
| `project` | `.claude/settings.json` | Shared via VCS |
| `local` | `.claude/settings.local.json` | Project-specific, gitignored |
| `managed` | Managed settings | Read-only |

### Hooks inside a plugin

Same event names and shape as `settings.json` `hooks`, but:
- Commands should reference scripts with `${CLAUDE_PLUGIN_ROOT}`, not absolute paths
- Hook scripts must be executable (`chmod +x`)
- Event names are case-sensitive (`PostToolUse`, not `postToolUse`)
- Hook types: `command`, `http`, `mcp_tool`, `prompt`, `agent`

### User-facing config

The `userConfig` field in `plugin.json` declares values Claude Code prompts for at enable time. Each is exposed as `${user_config.KEY}` for substitution and as `CLAUDE_PLUGIN_OPTION_<KEY>` env var. Sensitive values go to the system keychain.

---

## 2. Construct → plugin slot mapping

### What ships in the plugin

| Construct surface | Plugin slot | Notes |
|---|---|---|
| `src/skills/<name>/SKILL.md` (17 skills) | `skills/<name>/SKILL.md` | Direct map. **Namespace change:** `/audit` → `/construct:audit`, etc. |
| `src/agents/*.md` (7 agents) | `agents/*.md` | All current agents only use `name`, `description`, `model`, `tools` — all supported by plugin agents. |
| `src/commands/*.md` (16 flat commands) | `commands/*.md` | Same namespace change as skills. |
| `src/core/hooks/*.ts` + `src/memory/hooks/*.ts` (19 hooks) | `hooks/hooks.json` | Rewrite commands from `bun src/...` to `bun "${CLAUDE_PLUGIN_ROOT}"/...`. Same JSON shape as `settings-hooks.json`. |
| `src/goals/mcp/` (MCP server) | `.mcp.json` + bundled source | `"command": "bun"`, `"args": ["${CLAUDE_PLUGIN_ROOT}/goals/mcp/src/index.ts"]`. |
| `src/skills/skill-rules.json` (router config) | Ship at plugin root in `skills/skill-rules.json` | Already lives there. Read by `routing-classify-submit.ts` via `dirname(Bun.main)` walk, which works unchanged. |
| `src/core/construct.config.json` | Bundle inside plugin tree | Internal config consumed by Construct code; not a plugin slot. |
| `src/rules/*` (rule families: code, design, docs, agent, security) | Bundle inside plugin tree | Referenced by skills via relative paths from `${CLAUDE_PLUGIN_ROOT}`. |
| `src/data`, `src/logger`, `src/telemetry`, `src/eval`, `src/trace.ts`, `src/hook-report.ts`, `src/status.ts` | Bundle inside plugin tree as `lib/` (or keep current paths) | Internal modules imported by hooks. Need `bun install` against bundled `package.json` at first run — see Bun-runtime note below. |
| `src/core/CLAUDE.md` + `src/core/identity/*.md` (SOUL/STYLE/USER/AGENTS) | Wrap as a single auto-loaded skill | **The big problem.** Plugins explicitly do NOT load a `CLAUDE.md` at plugin root. The docs say: *"To ship instructions that load into Claude's context, put them in a skill."* So: pack the identity layer into a `skills/construct-identity/SKILL.md` with `disable-model-invocation: false` and a `description` that triggers on every relevant context — or use a `SessionStart` hook that prints the identity content. See decision #3. |

### What does NOT ship in the plugin

| Surface | Why it can't ship | Where it goes instead |
|---|---|---|
| `src/ui/` (Fastify API + React SPA, ~200 npm deps, systemd service) | Plugins have no "host a long-running web server" slot. UI runs as a persistent daemon. | Stays a separate install — current `bun install.ts` path, or replaced by the Tauri menubar shell in Phase 3. The plugin is decoupled from the UI. |
| `~/.claude/settings.json` permissions (`Bash`, `Read`, `Mcp`, `mcp__goal-tracker__*`, etc.) | Plugin `settings.json` only honors `agent` and `subagentStatusLine`. Permissions can't be set by a plugin. | Document required permissions in plugin README; user adds them on first install. |
| `~/.claude/CLAUDE.md` global behavioral rules | Plugins can't write to user CLAUDE.md. | Same answer as identity layer — wrap in a skill. |
| Systemd unit (`construct-ui.service`) | Plugins don't manage system services. | Ships with the separate UI install. |
| User data at `~/.construct/` (DB, sessions, signals, memory) | Plugin install dir is ephemeral (`${CLAUDE_PLUGIN_ROOT}` changes on update). User data must outlive plugin versions. | Stays at `~/.construct/`. Plugin reads/writes it directly via env-var or fixed path. The `${CLAUDE_PLUGIN_DATA}` slot is reserved for plugin-managed state (e.g. installed deps), not user data. |

### Three architectural problems to solve before task #3

These came out of the mapping. Each forces a decision before the skeleton is buildable.

#### Problem A — Skill namespace breakage

Plugin skills are always namespaced: `/construct:audit`, not `/audit`. Three impacts:

1. **User muscle memory breaks.** Anyone who installs Construct as a plugin must re-learn invocations.
2. **Construct's own router emits unnamespaced names.** `routing-classify-submit.ts` matches keywords and emits matched skill names. Inside a plugin, the emitted names need a `construct:` prefix or they won't dispatch.
3. **Skill cross-references break.** Skills that mention `/code-review` in their body would need to say `/construct:code-review`.

Mitigation: the plugin name itself can shorten the prefix. A plugin named `c` would namespace as `/c:audit`. But the plugin name also drives the marketplace listing and search discoverability, and `c` is unhelpful there. Likely answer: name the plugin `construct`, accept the prefix change, update the router and skill cross-refs.

#### Problem B — Identity layer can't ship via CLAUDE.md

Per `code.claude.com/docs/en/plugins-reference`: *"A `CLAUDE.md` file at the plugin root is not loaded as project context."*

Construct's identity layer (SOUL, STYLE, USER, AGENTS) is the most opinionated thing Construct does — it's how Construct *behaves*. Without it, the plugin is a bag of skills with no personality. Two paths:

- **Skill-wrapped identity**: a single skill `construct-identity` whose body is the concatenated identity files, with a description that pulls it into context for every session. The skill router triggers it on session start.
- **SessionStart hook that prints identity**: the hook reads the identity files from `${CLAUDE_PLUGIN_ROOT}/core/identity/` and emits them as system context.

The hook approach is more reliable (no skill-matching ambiguity) but it adds context cost on every session even when not needed. The skill approach is cleaner but depends on the skill being loaded. Defer the final pick to decision #3.

#### Problem C — Bun runtime + workspace npm deps

Construct's hooks are `bun *.ts` files that import from `@construct/data`, `@construct/logger`, etc. (workspace packages). The plugin install dir is read-only-ish (cache) and dependency-free out of the box.

Three things must happen on plugin install:

1. **Bun must be on the user's PATH.** Document as a hard prerequisite in the plugin README. No way to install bun from inside a plugin.
2. **`bun install` must run** against the bundled `package.json` to materialize `node_modules`. This must land in `${CLAUDE_PLUGIN_DATA}` (persistent dir), not `${CLAUDE_PLUGIN_ROOT}` (ephemeral). Use the `SessionStart` hook pattern documented in the plugin reference (line 580 of the canonical docs): `diff` the bundled `package.json` against the cached copy, reinstall if changed.
3. **Imports must resolve** against `${CLAUDE_PLUGIN_DATA}/node_modules`. Means setting `NODE_PATH` or rewriting workspace imports to relative paths. Plain `NODE_PATH` is simplest.

---

## 3. Decisions

| # | Decision | Status |
|---|---|---|
| 1 | Plugin name: **`construct`**. Skills namespace as `/construct:<skill>`. | proposed |
| 2 | UI is **decoupled** — plugin ships Claude Code components only. UI install stays separate (current `bun install.ts`) until Phase 3. | proposed |
| 3 | Identity layer ships as a **`SessionStart` hook** that emits SOUL/STYLE/USER/AGENTS content to system context. More reliable than skill-wrapped identity; users can override per-session by disabling the plugin. | proposed |
| 4 | Workspace deps install via **`SessionStart` hook + `${CLAUDE_PLUGIN_DATA}/node_modules`** + `NODE_PATH` env on hook commands. Bun documented as a hard prereq. | proposed |
| 5 | Router (`routing-classify-submit.ts`) emits **namespaced** skill names (`construct:<name>`). Update the hook. | proposed |
| 6 | Version strategy: **omit `version` field initially**, use git commit SHA. Switch to explicit semver once external users dogfood. | proposed |
| 7 | Marketplace lives at **`.claude-plugin/marketplace.json` in this repo** — no separate marketplace repo. Plugin source = relative path (`"./plugin"`) once the built tree is committed. Don't submit to `anthropics/claude-plugins-official` until external dogfooding. (Earlier plan said "own marketplace repo first" — that was wrong; verified against `code.claude.com/docs/en/plugin-marketplaces`.) | revised |
| 8 | Permissions are **documented in plugin README**, not auto-set. (Plugin `settings.json` only honors `agent` and `subagentStatusLine`.) | from research |

---

## 4. Skeleton (task #3)

`dist-plugin.ts` at repo root generates a loadable plugin tree under `dist/plugin/`. Run with `bun dist-plugin.ts`. Output validates with `claude plugin validate dist/plugin` (one expected warning: no version, see decision #6).

### What ships in v1

| Component | Count | Plugin slot |
|---|---|---|
| Skills (one dir per SKILL.md, with full scaffold) | 17 | `skills/<name>/` |
| Agents | 7 | `agents/*.md` |
| Commands | 16 | `commands/*.md` |
| Hooks (rewritten with `${CLAUDE_PLUGIN_ROOT}`) | 19 | `hooks/hooks.json` |
| MCP servers (goal-tracker) | 1 | `.mcp.json` |
| Internal modules (`core/`, `data/`, `logger/`, `telemetry/`, `eval/`, `goals/`, `memory/`, `research/`, `rules/` + `trace.ts`, `hook-report.ts`, `status.ts`) | — | bundled in-tree |
| Skill-router config (`skills/skill-rules.json`) | — | bundled; router walks `dirname(Bun.main)` and finds it unchanged |

### Smoke tests run

- `claude plugin validate dist/plugin` — passes with warnings (no `version`, two commands without frontmatter)
- `routing-classify-submit.ts` invoked with `CLAUDE_PLUGIN_ROOT=$PWD/dist/plugin` + test input → matched `code-review, audit` ✓
- `quality-format-edit.ts` and `security-scan-bash.ts` invoked similarly → silent success (nothing to flag) ✓

### Deferred to follow-up commits

| # | What | Why deferred |
|---|---|---|
| F1 | Router emits namespaced skill names (`construct:<name>` instead of `<name>`) per decision #5 | Skeleton tests showed router works structurally; namespacing is a one-line change but interacts with `agent-review` skill that currently audits unnamespaced names |
| F2 | `SessionStart` identity-injection hook (problem B / decision #3) | Needs the actual `hookSpecificOutput.additionalContext` mechanism wired; bigger than skeleton scope |
| F3 | MCP server npm-deps install via `${CLAUDE_PLUGIN_DATA}` (problem C / decision #4) | Only the MCP server needs deps — hooks use relative imports + bun built-ins. Implement when MCP server is actually exercised |
| F4 | Source-side cross-refs: skills that say `/code-review` in their body would need `/construct:code-review` after install | Cosmetic — works either way |
| F5 | `commands/goal.md` is empty, `commands/install.md` lacks frontmatter (validator warnings) | `install.md` is a dev-only command and probably shouldn't ship in the plugin at all; needs a skip-list in the builder |
| F6 | YAML frontmatter audit across all skills | Pre-existing bug discovered: `agent-review` and `code-suggest` had `:` inside unquoted scalars and loaded with **empty metadata** in the existing install too. Fixed in this branch; a /docs-review on every SKILL.md would surface any others |

### Known incompatibilities

- The plugin assumes `bun` is on the user's PATH. No way to install bun from inside a plugin — must document as a hard prerequisite in the plugin README.
- Construct's hooks rely on `~/.construct/` for user data. Plugin install does not create this dir; needs task #4 resolution.
- Skills are namespaced — users who installed via `bun install.ts` invoke `/audit`; plugin users invoke `/construct:audit`. The two install methods are not interoperable; a user should pick one.


