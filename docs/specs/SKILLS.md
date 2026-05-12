# Skills

Skills are reusable AI behaviors loaded on demand. They are registered as slash commands and triggered either by explicit invocation (`/skill-name`) or by keyword detection from `skill-rules.json`.

## Keyword-triggered skills

These skills auto-trigger when matching keywords appear in a user prompt.

| Skill | Description | Trigger keywords |
|---|---|---|
| `agent-browser` | Browser automation CLI for AI agents — navigate pages, fill forms, click, screenshot, scrape | `agent-browser`, `browser automation`, `open a website`, `fill out a form`, `click a button`, `take a screenshot`, `scrape data`, `automate browser`, `web automation`, `navigate page`, `browser cli` |
| `code-debug` | Enforces root-cause analysis before any fix — investigate, pattern analysis, hypothesis test, minimal implementation | `systematic debug`, `root cause`, `trace data flow`, `no fixes without`, `thrashing`, `multiple fixes failed`, `3 fixes`, `phase 1 investigation` |
| `code-refactor` | Refactor code for better organization, cleaner architecture, or improved maintainability | `refactor`, `reorganize files`, `restructure code`, `extract component`, `move files`, `update imports`, `file organization`, `break down this file`, `split this module` |
| `code-review` | Review code for issues then refactor — review phase produces findings, refactor phase executes approved fixes | `code review`, `review this code`, `architecture review`, `review my implementation`, `check my code`, `review the changes`, `architectural consistency`, `code quality review` |
| `code-simplify` | Remove AI-generated code slop, unnecessary comments, and over-engineering; refine for clarity and consistency | `deslop`, `remove slop`, `clean up code`, `remove boilerplate`, `over-engineered`, `unnecessary comments`, `simplify before commit`, `strip defensive code`, `simplify code`, `refine code`, `code elegance`, `code simplifier`, `improve code clarity`, `reduce complexity` |
| `context-compact` | Guide context compaction at logical task phase boundaries rather than letting auto-compaction hit mid-task | `compact`, `context window`, `token budget`, `context limit`, `when to compact`, `compaction`, `context pressure`, `compress context` |
| `design-audit` | Systematic UI/UX design audit against all 18 dimensions of `src/rules/design/RULES.md`: hierarchy, typography, color, components, state coverage, dark mode, density, responsiveness, accessibility, forms, performance, hydration, locale, anti-patterns | `design audit`, `audit the design`, `audit the ui`, `audit ui`, `design review`, `make this feel professional`, `polish the interface`, `ux audit`, `typography`, `fix typography`, `em dash`, `en dash`, `text hierarchy`, `web standards`, `check accessibility`, `a11y`, `best practices`, `review ux`, `font size` |
| `design-fix` | Apply approved `tag: peer-drift` findings from `design-audit` — propagate a layout, component composition, state coverage, token usage, or microcopy pattern across peer UI surfaces | `design-fix`, `design-conform`, `conform`, `make the pages match`, `align the layouts`, `same loading state`, `match the table headers`, `make the components consistent` |
| `docs-author` | Create, update, or enhance documentation — developer guides, README files, API docs, data flow diagrams | `document this`, `write documentation`, `create docs`, `update the docs`, `write a readme`, `api documentation`, `document the architecture`, `data flow diagram`, `architectural overview` |
| `docs-optimize` | Optimize documentation for AI coding assistants — c7score optimization, llms.txt generation | `optimize docs`, `optimize documentation`, `c7score`, `llms.txt`, `llmstxt`, `context7`, `ai documentation`, `llm docs`, `docs optimizer`, `documentation quality` |
| `eval-harness` | Define and run evals to measure AI development reliability — pass@N scoring, A/B trials | `eval`, `pass@`, `pass@1`, `pass@3`, `reliability`, `regression eval`, `capability eval`, `eval-driven`, `define eval`, `run eval`, `eval report` |
| `git-workflow` | Full git workflow — isolate work in a branch or worktree, implement, then land via merge, PR, or discard | `worktree`, `create worktree`, `isolated branch`, `parallel branch`, `wrap up`, `wrapping up`, `finish the branch`, `finish this branch`, `merge this`, `time to merge`, `merge the branch`, `ship the feature`, `close out the branch`, `how do i finish`, `feature branch`, `start a branch`, `new branch` |
| `ralph-loop` | Autonomous iterative development loop — dispatches fresh-context subagents that check prior work via files and git history | `ralph`, `ralph loop`, `autonomous loop`, `keep iterating`, `iterate until` |
| `research` | Deep autonomous research — long-running investigations with budgets and persistence | `investigate`, `deep research`, `research how`, `research why`, `research what`, `in-depth research`, `comprehensive research`, `long-running research`, `persistent research` |
| `search` | Quick web research — search, synthesize, report with sources | `search for`, `look up`, `find out`, `what is`, `how does`, `compare`, `search online`, `web search`, `find examples`, `evaluate options`, `search-first` |
| `skill-creator` | Creates, improves, and benchmarks skills via draft–test–review–iterate loops with quantitative performance measurement | `create a skill`, `make a skill`, `new skill`, `write a skill`, `skill creator`, `improve skill`, `optimize skill`, `skill description`, `skill eval`, `test a skill` |
| `test-webapp` | Playwright-based toolkit for testing local web apps — server lifecycle, DOM inspection, screenshots, browser automation | `test webapp`, `test web app`, `playwright`, `browser test`, `frontend test`, `ui test`, `screenshot`, `browser automation`, `test local server`, `verify ui`, `test the ui` |
| `verify-completion` | Enforces running verification commands with observed evidence before claiming work is complete, passing, or fixed | `verify`, `check it works`, `make sure it works`, `confirm it works`, `prove it works`, `show me it works`, `does it work`, `validate`, `end to end`, `e2e` |

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
| `/install` | Deploy Construct to `~/.claude` — copies `src/`, builds frontend, restarts service |
| `/research` | Start, manage, and steer autonomous deep research sessions |
| `/search` | Quick web research — search, synthesize, report with sources |
| `/todo` | Manage todos — list, add, recurring via goal-tracker MCP |

### Project-local commands

Defined in `.claude/commands/`, available only in the Construct repo.

| Command | Description |
|---|---|
| `/install` | Run `bun install.ts` + post-install verification |
| `/link` | Symlink `~/.claude/construct` → `src/` for live development |
| `/wipe` | Clear research/telemetry data |
