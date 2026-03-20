# Construct — Functional Specification

Behavior-oriented spec for functional testing and drift detection. Every claim here is testable.

## Session Lifecycle

### Starting a session

On `SessionStart`, the user sees:

```
=== Session Start ===
Sessions: <N>

Last session (<filename>):
  - Intent: ...
  - Outcome: ...
  - Tools: ...; files: ...
  - Edits: ...
  - Messages: ...

[memory] Search semantic memory (memory_search) for relevant project context before starting work.
====================
```

- Session count is the number of `.md` files in `memory/sessions/`.
- The last session block is shown only when at least one session file exists. It displays the most recent session summary (minus the `# Session:` heading), indented.

The BOOTSTRAP.md initialization sequence then runs silently: semantic memory search, session count, worktree detection, depth defaulting to QUICK.

### During a session

**Depth classification** — on every prompt (≥3 words), `format-reminder.ts` classifies depth:
- FULL if prompt matches architectural keywords (`architect|redesign|refactor|migrate|schema|structure|plan|propose`) or is ≥40 words.
- QUICK otherwise (silent).
- Output when FULL (architectural keywords): `[Construct] Depth: FULL — architectural keywords. Write ISC before proceeding.`
- Output when FULL (≥40 words): `[Construct] Depth: FULL — complex request. Consider ISC.`

**Skill matching** — same hook checks prompt against `skill-rules.json` keywords. On match: `[Construct] Matched skills: <names>. Activate via Skill() before proceeding.` No match = silent.

**Rating capture** — on every prompt, `rating-capture.ts` checks for explicit ratings:
1. Standalone integer 1–10 as the entire prompt
2. N/10 pattern anywhere (e.g. `8/10`)
3. Words "rate"/"rating" plus a 1–10 digit

Matched ratings are appended to `memory/signals/ratings.jsonl`:
```json
{"timestamp":"<ISO>","rating":8,"type":"explicit","context":"<first 100 chars>"}
```
Ratings 1–3 trigger a console message: `[Construct] Low rating (N) — store what went wrong via memory_store`. Ratings 4–10 are silent.

**Quality hook** — after every `Edit` or `Write` tool use, `quality.ts` auto-formats the saved file:
- If `.claude/quality.json` exists in the project, runs its `format` and `lint` commands with `$FILE` substituted.
- Otherwise, extension-based defaults: `.py` → ruff, `.ts/.tsx/.js/.jsx` → prettier, `.go` → gofmt, `.rs` → rustfmt.
- Skips silently if the formatter binary isn't installed.
- All output is suppressed; failures are silent. The file is modified in place.

### Ending a session

On `Stop`, two hooks fire in order:

**1. Memory gate** (`memory-gate.ts`) — enforces `memory_store` before exit on substantive sessions:
- Substantive = ≥6 messages AND ≥1 Edit/Write/Bash tool use.
- If `memory_store` was called: allows exit.
- If not: blocks exit once with a prompt to call `memory_store` with a session summary. On second Stop, allows exit regardless.

**2. Session summary** (`session-summary.ts`) — writes a summary file if the session had ≥4 messages:
- Output: `memory/sessions/YYYY-MM-DD-HHMMSS.md`:
  ```markdown
  # Session: 2026-03-12

  - Intent: <first user message text>
  - Outcome: <last user message text>
  - Milestones:
    - <intermediate user messages>
  - Tools: Read, Edit, Bash, Glob, Grep; files: hooks/session-start.ts, memory/README.md
  - Edits: 5 tool calls, 3 files
  - Messages: 12 (6 user, 6 assistant)
  - Notes:
    - <assistant message summaries>
  ```
- Up to 8 tool names, 12 file paths, 4 milestones, 5 notes.
- Fully silent.

## Statusline

Rendered continuously via `StatusUpdate` event. Shows:

```
<model name>  ⎇ <git branch>  <dir name>  [████░░░░░░] 42%
```

- Uses external `ccstatusline` binary directly (no fallback wrapper).
- Shows: model display name, git branch, cwd, context window bar + percentage.

## Notifications

On `Notification` events (`idle`, `permission`, `complete`):
- **WSL** (detected via `/proc/version`): Windows Toast via PowerShell WinRT APIs.
- **macOS**: `osascript display notification`.
- **Fallback**: terminal bell (`\x07`).

Messages: idle → "Claude is waiting for input", permission → "Claude needs permission to proceed", complete → "Claude finished the task".

## Skills

Skills are domain-specific playbooks activated by keyword matching. Each lives in `construct/skills/<name>/SKILL.md`.

### research

**Activated by:** research, investigate, look into, find out, compare, survey, analyze

**Behavior:** Claude defines scope as ISC criteria before searching. Fires parallel searches. Requires fetching full source pages (not snippets). Synthesizes against original questions with inline source links. Notes gaps explicitly. Conflicting evidence must not be omitted.

### verification

**Activated by:** verify that, verify it, confirm passing, validate that, prove it works, verification

**Behavior:** The Iron Law — no completion claim without same-message evidence. Claude must run the verification command fresh and report inline: `✓ [command] → [result]` or `✗ [command] → [actual vs expected]`. "Should work", "looks right", and "linter passed" are explicitly insufficient.

### debugging

**Activated by:** debug, bug, broken, failing, error, crash, exception, traceback, root cause, bisect

**Behavior:** Four phases:
1. Root cause investigation — read errors, reproduce, trace call chain to origin (never fix at symptom site).
2. Pattern analysis — find working examples, compare.
3. Hypothesis + test — one variable at a time, predict before changing.
4. Implementation — failing test first, then fix, then regression suite.

Hard stop: if 3+ consecutive fixes fail, escalate to human.

### subagent-dev

**Activated by:** subagent, parallel tasks, dispatch, multi-task, implementation plan, execute plan

**Behavior:** Each independent task gets a fresh subagent with exactly the context it needs (no session history). Two mandatory review stages per task: spec compliance (haiku), then code quality (sonnet). Failures trigger implementer rework + re-review. Single task = skip this skill, just do it directly. Stop-on-3-failures rule.

### code-review

**Activated by:** dead code, unused, clean up, cleanup, simplify, code quality, code review, lint

**Behavior:** Scans files for 8 categories: unused imports, unreferenced functions, commented-out code, orphaned files, duplicate utilities, silent failures, misnamed identifiers, redundant logic. Verifies each candidate is truly dead (project-wide search). Removes one category at a time with test verification. Also checks dead references in configs/docs. Reports what was removed and what was flagged.

### docs-review

**Activated by:** doc sync, docs drift, documentation mismatch, docs match

**Behavior:** Enumerates every factual claim in docs (file paths, hook registrations, behavior claims, directory layout). Verifies each against truth source (filesystem, settings.json, command output). Checks spec completeness (hooks, commands, skills all documented). Reports ✓/✗/⚠ per claim.

### instructions-review

**Activated by:** audit instructions, review rules, contradictions, vague instructions, instruction quality

**Behavior:** Reads all instruction files (CLAUDE.md, identity files, SKILL.md, command files). Checks for five problems: vague/ambiguous instructions, contradictions between files, impossible instructions (referencing nonexistent things), duplication across files, missing essential information. Reports by file, sorted by severity.

### ralph-loop

**Activated by:** ralph, ralph loop, autonomous loop, keep iterating, iterate until

**Behavior:** Named after Ralph Wiggum — kind of dumb, kind of lovable, and he never gives up. Iterations are dispatched as subagents (parallel by default for independent work, sequential for dependent work). Progress lives in files, not context windows. Each agent writes to a known output location. Failures are data — the next agent learns from them.

## Slash Commands

Subcommands of `/construct`, routed by `commands/construct.md`:

| Command | Behavior |
|---------|----------|
| `install` | Runs `bun install.ts`, then auto-runs `verify` |
| `verify` | Reads each installed module's INSTALL.md, runs every check individually, reports ✓/✗/⚠ grouped by module |
| `grasp` | Externalizes Claude's mental model: commandments (verbatim), project identity, stack, active work, key files, conventions, uncertainties. Ends with "Is any of this wrong or out of date?" |
| `status` | Shows: identity files present, active skills, semantic memory context, session signals (rating counts + rolling average), last 5 sessions, memory size |
| `retain` | Shows last 5 session summaries. Prompts for which to promote to semantic memory via `memory_store` |
| `trace` | Toggles `~/.claude/construct/.trace` flag file. With args: one-shot trace (enable, run command, restore previous state) |
| `audit` | Three-skill project audit: code-review, instructions-review, docs-review. Auto-fixes code/refs with approval; instructions/docs presented for review |


## Installer

**Invocation:** `bun install.ts` from repo root.

**Steps:**
1. **Backup** preserved files to `/tmp/construct-backup-XXXXX/`.
2. **Sync** `construct/` tree destructively — copies everything from repo, deletes stale files in target.
3. **Restore** backed-up preserved files over the fresh sync.
4. **Sync commands** — installs from repo, removes known stale Construct commands. User-created commands untouched.
5. **Merge settings.json** — replaces `hooks` and `statusLine` only. Rewrites relative paths to absolute `$HOME`-based paths. All other keys preserved.
6. **Update CLAUDE.md** — replaces `# Construct` section in-place. Content before and after preserved. Appends if no section exists.

**User sees:**
```
=== Construct Installer ===
src: /home/.../Construct
dst: /home/.../.claude

backing up preserved files...
  preserved: core/identity/SOUL.md
  ...
syncing construct/...
restoring preserved files...
syncing commands...
  installed: construct.md
merging settings.json...
updating CLAUDE.md...

done. run /verify to check installation.
```

**Preserved on upgrade:**
- ALL CAPS `.md` files (`[A-Z_]+.md`) in `construct/core/identity/`
- `memory/signals/ratings.jsonl`
- `memory/sessions/` contents


**Overwritten on upgrade:**
- All hooks, skills, meta, dev files
- README.md and INSTALL.md files within modules
- Non-ALLCAPS files in construct/

## Identity Layer

Five optional files in `construct/core/identity/`, preserved on upgrade:

| File | What it changes |
|------|----------------|
| SOUL.md | Values and mental models: correctness over speed, simplicity, honesty, minimal footprint, YAGNI, blast radius awareness. Self-awareness of biases (over-engineering, completionism, verbosity, anchoring) |
| IDENTITY.md | Tone: terse by default, matches user energy, pragmatic engineer, no filler phrases, no hedging, pushes back when wrong, treats silence as permission |
| STYLE.md | Output format: answer-first, bullets for 3+ items, `path:line` references, no headers in short responses. Code: functional where clear, early returns, match existing style |
| USER.md | Principal profile: environment, working style, communication preferences. Partially filled template |
| BOOTSTRAP.md | Session init sequence: memory search, session count, worktree detection, default to QUICK depth |

## Modules

Five modules, installed in dependency order. Core is always required; the others are inert if unused.

### construct-core

**Depends on:** nothing

**Provides:**
- `~/.claude/CLAUDE.md` with `# Construct` section (sections: `## Behavior`, `## Task Execution`, `## Module Installation`, `## Thinking Tools`)
- `~/.claude/settings.json` (permissions, statusline, hooks)
- `ccstatusline` external binary (StatusUpdate event, 3000ms timeout)
- `construct/core/identity/` — optional identity files (see [Identity Layer](#identity-layer))

### construct-memory

**Depends on:** construct-core

**Provides:**
- `construct/memory/hooks/` — session-start.ts, rating-capture.ts, memory-gate.ts, session-summary.ts
- `construct/memory/sessions/` — session summary files
- `construct/memory/signals/ratings.jsonl` — explicit + implicit rating history
- CLAUDE.md sections: `## Memory` (with `### Semantic memory (mcp-memory-service)`), `## Identity Files`

Two memory layers: semantic (mcp-memory-service, decisions/patterns/preferences, searched on demand) and signals (ratings/session history, append-only file-based).

### construct-skills

**Depends on:** construct-core

**Provides:**
- `construct/skills/skill-rules.json` — keyword routing config (8 rules)
- `construct/skills/hooks/format-reminder.ts` — UserPromptSubmit depth classification + skill matching
- `construct/skills/hooks/quality.ts` — PostToolUse auto-formatter (matcher: `Edit|Write`)
- `construct/skills/hooks/notify.ts` — Notification alerts
- CLAUDE.md section: `## Agent Personas`
- Eight skill playbooks in `construct/skills/<name>/SKILL.md`: research, verification, debugging, subagent-dev, code-review, docs-review, instructions-review, ralph-loop

**Skill routing keywords:**

| Skill | Keywords |
|-------|----------|
| research | research, investigate, look into, find out, compare, survey, analyze |
| verification | verify that, verify it, confirm passing, validate that, prove it works, verification |
| debugging | debug, bug, broken, failing, error, crash, exception, traceback, root cause, bisect |
| subagent-dev | subagent, parallel tasks, dispatch, multi-task, implementation plan, execute plan |
| code-review | dead code, unused, clean up, cleanup, simplify, code quality, code review, lint |
| docs-review | doc sync, docs drift, documentation mismatch, docs match |
| instructions-review | audit instructions, review rules, contradictions, vague instructions, instruction quality |
| ralph-loop | ralph, ralph loop, autonomous loop, keep iterating, iterate until |

### construct-meta

**Depends on:** construct-core

**Provides:**
- `construct/meta/README.md` — cross-module utilities reference
- `~/.claude/commands/construct.md` — `/construct` slash command router

### construct-dashboard

**Depends on:** construct-core

**Provides:**
- `construct/dashboard/api/` — Fastify 5 REST API with Drizzle ORM + better-sqlite3 (SQLite, WAL mode)
- `construct/dashboard/web/` — React 19 SPA with Vite 6, Tailwind CSS v4, TanStack Query v5
- `construct/dashboard/mcp/` — MCP server wrapping the REST API (stdio transport)
- `construct/dashboard/shared/` — Zod validators and TypeScript types

**Data model:** goals, categories (many-to-many), notes (per-goal), todos (with due dates), recurring todos (daily/weekly/monthly with period-keyed completions), history logs, webhooks, API tokens.

**Integration:** Construct interacts via the MCP server. MCP tools: list_goals, get_goal, create_goal, update_goal, delete_goal, list_categories, create_category, delete_category, list_notes, add_note, update_note, delete_note, list_todos, create_todo, update_todo, delete_todo, list_recurring_todos, create_recurring_todo, complete_recurring_todo, get_summary, get_history.

**Auth:** WebAuthn/Passkeys for web UI. API token (Bearer) auth for MCP/agent access. Dev bypass when no credentials registered.

**Running:** `npm run dev` from `construct/dashboard/` starts API on :3001 and Vite on :5173. `npm run build` builds shared → api → web. `npm test` runs Vitest integration tests.

## Hook Registration

All hooks in `settings.json` under `hooks`:

| Event | Hooks (in order) | Timeouts |
|-------|-----------------|----------|
| SessionStart | memory/hooks/session-start.ts | 5000ms |
| UserPromptSubmit | memory/hooks/rating-capture.ts, skills/hooks/format-reminder.ts | 2000ms, 3000ms |
| Stop | memory/hooks/memory-gate.ts, memory/hooks/session-summary.ts | 5000ms, 3000ms |
| PostToolUse | skills/hooks/quality.ts (matcher: `Edit\|Write`) | 10000ms |
| Notification | skills/hooks/notify.ts | 3000ms |

No external API keys required. All hooks use context injection via stdin/stdout.

## settings.json Structure

Required top-level keys:
- `permissions` — `allow`, `deny`, `ask` arrays of permission patterns
- `statusLine` — `{ type: "command", command: string, timeout: number }`
- `hooks` — event name → array of hook group objects

Each hook group: `{ hooks: [{ type: "command", command: string, timeout: number }], matcher?: string }`

The installer rewrites relative paths (`bun construct/...`) to absolute `$HOME`-based paths during install.

## Trace Mode

- Flag file: `~/.claude/construct/.trace`
- When present: hooks emit trace output to stderr
- Default state: OFF (file does not exist)

## Module Detection

| Module | Detection file |
|------|---------------|
| construct-core | `~/.claude/CLAUDE.md` |
| construct-memory | `construct/memory/hooks/session-start.ts` |
| construct-skills | `construct/skills/skill-rules.json` |
| construct-meta | `construct/meta/README.md` |
| construct-dashboard | `construct/dashboard/api/src/app.ts` |

## Verification

Each module's INSTALL.md defines three categories of checks:
- **Files** — expected files exist at target paths
- **Data** — preserved files are non-empty and intact after upgrade
- **Functionality** — hooks exit 0 on trivial input, JSON is parseable, CLAUDE.md sections present
