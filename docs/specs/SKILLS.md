# Skills

Skills are reusable AI behaviors loaded on demand. They are registered as slash commands and triggered either by explicit invocation (`/skill-name`) or by keyword detection from `skill-rules.json`.

## Keyword-triggered skills

These skills auto-trigger when matching keywords appear in a user prompt.

| Skill | Description | Trigger keywords |
|---|---|---|
| `address` | Implement visual feedback from vibe-annotations and clear them once done | `address`, `annotations`, `fix my annotations`, `vibe annotations`, `implement the annotations`, `apply my feedback` |
| `agent-review` | Audit/fix AI-specific config (CLAUDE.md, hooks, skills, agents, subagents) — checks dispatch wiring, dead refs, orphaned skills | `agent-review`, `agent audit`, `audit my config`, `audit hooks`, `find dead hook outputs`, `audit my skills`, `find orphaned skills`, `audit my agents`, `agent routing collision` |
| `code-review` | Review code for issues then optionally fix — covers architecture, simplification, refactor, security; modes audit/fix | `code review`, `architecture review`, `code audit`, `apply the audit fixes`, `deslop`, `remove slop`, `clean up code`, `over-engineered`, `simplify`, `conform`, `apply this pattern`, `align`, `consolidate`, `deduplicate`, `refactor`, `restructure`, `security review`, `security audit`, `owasp`, `cwe`, `vulnerability scan`, `remediate security` |
| `code-test` | Front door for browser-driven testing — picks between agent-browser CLI (one-off automation, snapshots) and Playwright (assertion-based tests) | `code-test`, `test webapp`, `playwright`, `browser test`, `ui test`, `screenshot`, `agent-browser`, `browser automation`, `open a website`, `fill out a form`, `take a screenshot`, `scrape data` |
| `context-compact` | Guide context compaction at logical task phase boundaries rather than letting auto-compaction hit mid-task | `context window`, `token budget`, `context limit`, `context is full`, `save and clear`, `compaction reminder` |
| `debug` | Enforces root-cause analysis before any fix — investigate, pattern analysis, hypothesis test | `still failing`, `still erroring`, `not working`, `broken`, `root cause`, `debug`, `fix this error` |
| `design-review` | Audit/fix/enforce UI design against `src/rules/design/RULES.md` (18 dimensions) plus Aleph design tokens | `design review`, `design audit`, `audit ui`, `design-fix`, `design-conform`, `design-construct`, `design system`, `design tokens`, `polish the interface`, `ux audit`, `typography`, `accessibility audit`, `a11y` |
| `docs-review` | Audit/fix/optimize documentation — drift checks, c7score, llms.txt generation, author new docs | `docs review`, `docs audit`, `audit the docs`, `docs-conform`, `align the docs`, `write documentation`, `create docs`, `author docs`, `optimize docs`, `c7score`, `llms.txt` |
| `dogfood` | Try the system as a user would — exercise UI/API without internal knowledge | `dogfood`, `try this as a user`, `use it like a user`, `act like a user` |
| `git` | Full git workflow — branches, worktrees, commits, merges, pushes | `worktree`, `feature branch`, `merge this`, `commit and push`, `ship it`, `/git` |
| `interview` | Interview the user (clarify intent, requirements, constraints) before building | `interview me`, `grill me`, `stress-test this`, `challenge my design`, `poke holes in my plan` |
| `omnibus` | Orchestrator — runs all populated audit/fix cells in parallel, merges SARIF findings, presents phased report with approval gates | `/audit`, `/fix`, `/suggest`, `audit everything`, `audit all`, `audit the codebase`, `full review`, `comprehensive audit` |
| `ralph-loop` | Autonomous iterative development loop — dispatches fresh-context subagents that check prior work via files and git history | `ralph`, `ralph loop`, `autonomous loop`, `keep iterating`, `iterate until` |
| `red-team` | Adversarial review of your own plan with subagents — find holes, edge cases, failure modes | `red team this`, `tear this plan apart`, `adversarial review`, `grill yourself`, `have agents grill` |
| `search` | Quick web research — search, synthesize, report with sources | `search for`, `look up`, `find out`, `what is`, `how does`, `compare`, `web search`, `examine` |
| `skill-creator` | Creates, improves, and benchmarks skills via draft–test–review–iterate loops with quantitative performance measurement | `create a skill`, `new skill`, `write a skill`, `skill creator`, `improve skill`, `optimize skill`, `skill eval`, `test a skill` |

## Always-active skills

| Skill | Description | When active |
|---|---|---|
| `using-superpowers` | Establishes how to find and use skills — requires Skill invocation before any response; defines instruction priority | Session start and any task where a skill might apply |

## Slash commands

### Global commands

Installed from `src/commands/` to `~/.claude/commands/`. Available in all projects.

| Command | Description |
|---|---|
| `/code-review` | Review code for issues then refactor |
| `/feature` | Start and complete feature work in isolated worktrees |
| `/finish` | Mark a todo or goal as done via goal-tracker MCP |
| `/gist` | Surface current project understanding before implementation |
| `/goal` | Manage goals — list, create, update, delete via goal-tracker MCP |
| `/install` | Deploy Aleph to `~/.claude` — copies `src/`, builds frontend, restarts service |
| `/research` | Start, manage, and steer autonomous deep research sessions |
| `/search` | Quick web research — search, synthesize, report with sources |
| `/todo` | Manage todos — list, add, recurring via goal-tracker MCP |

### Project-local commands

Defined in `.claude/commands/`, available only in the Aleph repo.

| Command | Description |
|---|---|
| `/install` | Run `bun install.ts` + post-install verification |
| `/link` | Symlink `~/.claude/aleph` → `src/` for live development |
| `/wipe` | Clear research/telemetry data |
