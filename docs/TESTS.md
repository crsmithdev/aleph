# Tests

## Test runner

`bun test.ts` — custom runner that pipes JSON into hook scripts and checks stdout. Runs in CI on every push.

## Hook tests (`test.ts`)

| Section | What it covers |
|---|---|
| morning-briefing | Session digest rendering: background work, session counts, last session header |
| rating | Rating extraction from user messages (standalone numbers, "7/10", false positives) |
| extract | Correction detection regex, memory extraction from transcripts |
| skill | Skill routing classifier (debugging, research, verification, docs-review, code-review) |
| depth | Depth classifier (QUICK vs FULL) for prompt complexity |
| recall | Session recall: summarizing past work, detecting unfinished tasks |
| extension | Skill extension injection (code-review, debugging project extensions) |
| trace | Hook tracing output (`[trace:]` lines) |
| install | Installer sentinel file preservation across upgrades |
| identity | Identity files exist, are non-empty, and install correctly |
| vgate | Verification gate (`quality-stop-check-e2e.ts`): blocks edits without e2e evidence, detects playwright/cypress/devserver/chrome-devtools, requires artifacts, deduplicates files, handles malformed JSON, known gaps (Bash writes, Agent edits) |
| directive | Dispatch directive writing: architectural prompts get `dispatch`+`full`, quick prompts skip, questions get `full` only |

## Telemetry unit tests (`src/telemetry/__tests__/`)

| File | What it covers |
|---|---|
| `parser.test.ts` | JSONL discovery/parsing, tool_use/token/skill/hook/turn_duration extraction, caching, date filtering, corrupt line handling |
| `aggregator.test.ts` | Overview aggregation (sessions, messages, tool calls, cost), tool ranking, hook metrics (p50/p95), skill detection, token/cost/session aggregation, empty input |
| `pricing.test.ts` | Cost calculation per model (sonnet, opus, haiku), cache costs, unknown model handling, prefix matching |
| `e2e.test.ts` | Full pipeline: fixture JSONL → parser → aggregator, validates entry counts, token totals, tool counts, timestamps, subagent parsing, cross-session aggregation |

## API tests (`src/ui/api/src/__tests__/`)

| File | What it covers |
|---|---|
| `goals.test.ts` | Goals REST API: CRUD for categories, goals, notes, todos; state transitions; history entries |

## Browser e2e tests (`src/ui/e2e/`)

| File | What it covers |
|---|---|
| `goal-flow.test.ts` | Creates goals/todos via service layer, starts API server, opens browser, verifies goals appear in web UI |
| `observability-flow.test.ts` | Seeds obs_memory_snapshots in DB, starts API + Vite dev server, opens browser, verifies observability dashboard renders |
| `telemetry-e2e.test.ts` | Computes ground-truth metrics from raw fixture JSONL (no system imports), then verifies system parser+aggregator produce matching results |

## Hook e2e tests (`src/skills/hooks/__tests__/`)

| File | What it covers |
|---|---|
| `dispatch-e2e.test.ts` | Full dispatch lifecycle (48 checks): routing classifier → directives + session marker, dispatch gate blocks main session / allows subagents, inline override toggle, stop reminder counter (every 5th), hook event reporting, edge cases (no marker, malformed stdin, empty session ID) |
| `quality-gate-e2e.test.ts` | Full quality gate lifecycle (51 checks): stop hook marker creation (edits without e2e), marker clearing (playwright/cypress/devserver/chrome-devtools + artifacts), pre-tool gate block/allow, no-edit scenarios, stop_hook_active bypass, e2e signal detection (bun run e2e, next dev, chrome devtools), malformed input, hook invocation exclusion |

## Eval scenarios (`src/eval/scenarios/`)

| File | What it covers |
|---|---|
| `broken-math/math.test.ts` | Eval fixture: intentionally broken math tests for agent debugging scenarios |
| `todo-app/server.test.ts` | Eval fixture: todo app server tests |
| `todo-feature/server.test.ts` | Eval fixture: todo feature server tests |

## Coverage gaps

- **Git hooks** (`git-pre-require-commit.ts`) — no tests
