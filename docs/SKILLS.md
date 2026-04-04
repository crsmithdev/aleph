# Skills

Skills are reusable AI behaviors loaded on demand. They are registered as slash commands and triggered either by explicit invocation (`/skill-name`) or by keyword detection from `skill-rules.json`.

## Keyword-triggered skills

These skills auto-trigger when matching keywords appear in a user prompt.

| Skill | Description | Trigger keywords |
|---|---|---|
| `agent-browser` | Browser automation CLI for AI agents — navigate pages, fill forms, click, screenshot, scrape | `agent-browser`, `browser automation`, `open a website`, `fill out a form`, `click a button`, `take a screenshot`, `scrape data`, `automate browser`, `web automation`, `navigate page`, `browser cli` |
| `code-simplifier` | Simplifies and refines recently modified code for clarity and maintainability without changing behavior | `simplify code`, `refine code`, `code elegance`, `clean up code`, `code simplifier`, `improve code clarity`, `reduce complexity` |
| `finishing-a-development-branch` | Guides completion of a development branch — verifies tests, presents merge/PR/keep/discard options with worktree cleanup | `finishing a development branch`, `implementation complete`, `done with feature`, `feature complete`, `wrapping up`, `development complete`, `finishing up`, `branch ready`, `ready to ship`, `development done` |
| `finishing-branch` | Verifies completed feature branch work and guides through merge, PR, keep, or discard with appropriate cleanup | `finish branch`, `merge branch`, `create pr`, `ready to merge`, `branch done`, `pull request`, `open pr`, `make pr`, `submit pr` |
| `frontend-design` | Creates distinctive, production-grade frontend interfaces — commits to bold aesthetics, avoids generic AI look | `frontend design`, `ui design`, `landing page`, `web component`, `react component`, `html css`, `design system`, `web app ui`, `visual design`, `styled component`, `make it look good`, `design the ui`, `polish the ui` |
| `git-worktrees` | Sets up an isolated git worktree for parallel feature development with dependency install and baseline tests | `worktree`, `create worktree`, `isolated branch`, `parallel branch` |
| `ralph-loop` | Autonomous iterative development loop — dispatches fresh-context subagents that check prior work via files and git history | `ralph`, `ralph loop`, `autonomous loop`, `keep iterating`, `iterate until` |
| `research` | Structured research methodology for investigating topics and comparing options — parallel searches, source evaluation, synthesis | `research`, `investigate`, `look into`, `find out`, `compare`, `survey`, `analyze` |
| `skill-creator` | Creates, improves, and benchmarks skills via draft–test–review–iterate loops with quantitative performance measurement | `create a skill`, `make a skill`, `new skill`, `write a skill`, `skill creator`, `improve skill`, `optimize skill`, `skill description`, `skill eval`, `test a skill` |
| `systematic-debugging` | Enforces root-cause analysis before any fix — four phases: investigate, pattern analysis, hypothesis test, minimal implementation | `systematic debug`, `root cause`, `trace data flow`, `no fixes without`, `thrashing`, `multiple fixes failed`, `3 fixes`, `phase 1 investigation` |
| `using-git-worktrees` | Creates isolated git worktrees with smart directory selection and gitignore safety verification before executing plans | `using git worktrees`, `isolated workspace`, `worktree setup`, `before executing plan`, `isolation from current` |
| `verification-before-completion` | Enforces running verification commands with observed evidence before claiming work is complete, passing, or fixed | `complete`, `done`, `finished`, `it works`, `all tests pass`, `tests pass`, `linter clean`, `build succeeds`, `ready to commit`, `ready to merge`, `ship it`, `looks good` |
| `webapp-testing` | Playwright-based toolkit for testing local web apps — server lifecycle, DOM inspection, screenshots, browser automation | `test webapp`, `test web app`, `playwright`, `browser test`, `frontend test`, `ui test`, `screenshot`, `browser automation`, `test local server`, `verify ui`, `test the ui` |

## Always-active skills

| Skill | Description | When active |
|---|---|---|
| `using-superpowers` | Establishes how to find and use skills — requires Skill invocation before any response; defines instruction priority | Session start and any task where a skill might apply |

## Slash commands

These are invoked explicitly as `/command-name`. No keyword detection.

| Command | Description |
|---|---|
| `/finish` | Mark a todo or goal as done via goal-tracker MCP |
| `/gist` | Surface current project understanding before implementation |
| `/goal` | Manage goals — list, create, update, delete via goal-tracker MCP |
| `/research` | Start, manage, and steer autonomous deep research sessions |
| `/todo` | Manage todos — list, add, recurring via goal-tracker MCP |
