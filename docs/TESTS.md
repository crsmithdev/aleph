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
| vgate | Verification gate (`quality-stop-check-e2e.ts`): blocks edits without e2e evidence, detects playwright/cypress/devserver/chrome-devtools, requires artifacts, deduplicates files, handles malformed JSON, tool-result user messages don't split turns, known gaps (Bash writes, Agent edits) |
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

### `goal-flow.test.ts`

Seeds goals/todos via service layer, starts API + Playwright, verifies web UI renders them.

**Flow:**

| Step | What happens | Input | Output |
|---|---|---|---|
| 1. Seed DB | Creates temp SQLite DB, inserts 2 goals + 1 todo via `@construct/goals` service functions | Goal titles, priorities | `test.db` with seeded rows |
| 2. Start API | Launches Fastify server on random port against seeded DB | DB path, port 0 | HTTP server URL |
| 3. Launch browser | Headless Chromium via Playwright | Server URL | Browser context |
| 4. Goals page | Navigates to `/goals`, waits for render | — | Page content |
| 5. Verify goals list | Checks both goal titles visible, high-priority badge present | Page DOM | `check()` assertions |
| 6. Goal detail | Clicks into goal, verifies title + priority + Notes + History sections | Goal ID | Detail page DOM |
| 7. Todos page | Navigates to `/todos`, checks "Review PR #42" visible | — | Page DOM |
| 8. Navigation | Goes back to goals, verifies list still renders | — | Page DOM |
| 9. API check | GETs `/api/goals`, verifies JSON array returned | Fetch request | JSON response |

**Verification:** `check()` assertions on page DOM content (element text, badge classes) and API response shape.

### `observability-flow.test.ts`

Starts API + Vite + Playwright against real `~/.claude/projects` JSONL data, verifies all observability tabs.

**Flow:**

| Step | What happens | Input | Output |
|---|---|---|---|
| 1. Seed DB | Creates temp DB with `obs_memory_snapshots` table, inserts 2 snapshots | Memory snapshot rows | `test.db` |
| 2. Start API | Fastify on port 3001 with `CLAUDE_ROOT=~/.claude` | Real JSONL data | HTTP server |
| 3. Start Vite | Dev server on port 5199 proxying `/api` to port 3001 | Vite config | `http://localhost:5199` |
| 4. Launch browser | Headless Chromium via Playwright | Vite URL | Browser context |
| 5. Overview tab | Navigates to `/observability`, checks stat cards (Sessions, Messages, Tool Calls, Total Cost) + Daily Activity chart | — | Page DOM |
| 6. Tools tab | Checks Bash + Read appear in tools table | — | Table rows |
| 7. Hooks tab | Checks hooks table renders (or "no hook data" message) | — | Page DOM |
| 8. Tokens & Cost tab | Checks all cards + charts + model breakdown table | — | Page DOM |
| 9. Memory tab | Checks total=35, health score, by-type breakdown, top tags, trend chart, snapshot button | Seeded snapshots | Page DOM |
| 10. Time range | Switches between 7d and 90d presets, verifies page re-renders | Button clicks | Updated DOM |
| 11. Console errors | Reloads page, checks zero console errors | — | Console log |

**Verification:** `check()` assertions on DOM element visibility, text content, chart canvas presence.

### `telemetry-e2e.test.ts`

Computes ground-truth metrics independently from raw JSONL, then verifies system produces matching values.

**Flow:**

| Step | What happens | Input | Output |
|---|---|---|---|
| 1. Ground truth | Parses 5 fixture JSONL files directly (no system imports), counts tool calls, tokens, errors, sessions, subagents | Raw JSONL lines | `GroundTruth` object |
| 2. Copy fixtures | Copies fixture files into temp dir mimicking `~/.claude/projects/<project>/` | Fixture JSONL | Temp session dirs |
| 3. Seed DB | Creates temp DB with `obs_memory_snapshots` | — | `test.db` |
| 4. Start API | Fastify on port 3003 with `CLAUDE_ROOT=tempDir` | Fixture JSONL | HTTP server |
| 5. Start Vite | Dev server on port 5198 | — | `http://localhost:5198` |
| 6. Launch browser | Headless Chromium via Playwright | Vite URL | Browser context |
| 7. Overview | API: sessions, messages, tool calls, tool errors, cost match ground truth. UI: stat cards + chart visible | API JSON, page DOM | Assertions |
| 8. Tools | API: per-tool counts/errors match ground truth. UI: Bash + Read in table | API JSON, page DOM | Assertions |
| 9. Tokens | API: input/output/cacheRead/cacheCreation totals match ground truth | API JSON | Assertions |
| 10. Cost | API: total cost, model breakdown. UI: cost card + charts | API JSON, page DOM | Assertions |
| 11. Hooks | API: ranked hooks with timing data. UI: hooks page loads | API JSON, page DOM | Assertions |
| 12. Sessions | API: count, message totals. UI: rows in session table | API JSON, page DOM | Assertions |
| 13. Subagents | API: total/background dispatches. UI: "Total Dispatches" visible | API JSON, page DOM | Assertions |
| 14. Session trace | API: specific session has turns + spans. UI: Duration/Turns visible | API JSON, page DOM | Assertions |
| 15. Cross-check | Overview tool calls = ranked total, overview cost = cost total, session message totals consistent | API JSON | Consistency assertions |

**Verification:** Numeric equality against independently-computed ground truth (no system code in the ground truth computation). UI assertions on element text matching API values.

## Behavioral evals (`src/eval/`)

Evals launch Claude via the Agent SDK in a sandboxed scenario. Programmatic hooks delegate to real hook scripts as subprocesses — the scripts write telemetry to `hook-events.jsonl` and marker files, identical to production.

### `dispatch-e2e.test.ts`

Tests that the dispatch gate forces Claude to use the Agent tool instead of editing directly.

**Flow:**

| Step | What happens | Input | Output |
|---|---|---|---|
| 1. Setup sandbox | Copies `broken-math` scenario to temp dir, `git init` | Scenario files | Sandbox path |
| 2. Create data root | Temp dir for hook telemetry + signals | — | `signals/` dir |
| 3. Capture session ID | `UserPromptSubmit` hook writes SDK session ID to `signals/current-session-id` | SDK input | Marker file |
| 4. Launch Claude (with gate) | Agent SDK `query()` with `dispatch-pre-require-subagent.ts` as PreToolUse hook (via `realHookCallback`) | Task prompt + gate instructions | Claude session |
| 5. Gate enforcement | On each Edit/Write, hook subprocess fires: compares `session_id` to marker, blocks main session (exit 2), writes to `hook-events.jsonl` | SDK PreToolUse input | `decision: "block"` or allow |
| 6. Claude adapts | Claude uses Agent tool to dispatch edit to subagent | Block message | Agent tool call |
| 7. Check task | `bun test` in sandbox, `git diff --name-only` | Sandbox state | `taskSuccess`, `filesChanged` |
| 8. Launch Claude (bare) | Same scenario, no hooks | Task prompt | Baseline result |
| 9. Read telemetry | Parse `signals/hook-events.jsonl` | JSONL file | `HookEvent[]` |

**Verification:**

| Assertion | What it checks | Source |
|---|---|---|
| `agentDispatched` | Claude used Agent tool | PostToolUse tracker |
| `taskSuccess` | `bun test` passes in sandbox | Exit code |
| `filesChanged.length > 0` | Subagent modified files | `git diff --name-only HEAD` |
| `hook-events.jsonl exists` | Real hook script wrote telemetry | File existence |
| `dispatch-pre-require-subagent fired` | Events filtered by hook name | JSONL parse |
| Events have `PreToolUse` type | Correct event field | JSONL parse |
| Events have `sessionId` + `ts` | Telemetry format correct | JSONL parse |
| Bare: no events | No hooks = no telemetry | Empty file |
| Gate forced dispatch | Agent used only with gate, not bare | A/B comparison |

### `quality-gate-e2e.test.ts`

Combined dispatch + quality gate eval. Tests the full production flow: orchestrator dispatches to subagent, then must verify e2e before stopping.

**Flow:**

| Step | What happens | Input | Output |
|---|---|---|---|
| 1. Setup sandbox | Copies `todo-app` scenario (HTTP server with 2 bugs) | Scenario files | Sandbox path |
| 2. Count events | Reads existing `hook-events.jsonl` line count from `.dev/data` | Dev DB | `eventsBefore` |
| 3. Merge hooks | Combines dispatch hooks (UserPromptSubmit + PreToolUse) with quality hooks (Stop + PreToolUse) | Hook configs | Combined hook map |
| 4. Launch Claude (with gates) | Agent SDK `query()` with both gates, `CONSTRUCT_DATA_ROOT=.dev/data` so events land in dev DB | Task prompt + gate rules | Claude session |
| 5. Dispatch gate | PreToolUse hook blocks Edit/Write, Claude dispatches to subagent | Block message | Agent tool call |
| 6. Subagent fixes bugs | Subagent edits `server.ts`: fixes toggle (`!todo.done`) and POST response (201 + JSON) | Task context | Fixed code |
| 7. Quality gate | Stop hook reads transcript, finds edits without e2e, writes `require-e2e` marker, returns `systemMessage` forcing continuation | Transcript path | Marker file + continuation |
| 8. Orchestrator verifies | Starts `bun server.ts`, curls API endpoints, saves output to file | Server on port 3847 | `verify-output.txt` |
| 9. Quality gate clears | Stop hook reads transcript again, finds e2e + artifact, clears marker | Transcript path | Marker removed |
| 10. Check task | `bun test` in sandbox, `git diff --name-only` | Sandbox state | `taskSuccess`, `filesChanged` |
| 11. Launch Claude (bare) | Same scenario, no hooks | Task prompt | Baseline result |
| 12. Read telemetry | Count new events in dev DB `hook-events.jsonl`, check marker state | Dev DB | Event count, marker |

**Verification:**

| Assertion | What it checks | Source |
|---|---|---|
| `taskSuccess` | Both bugs fixed, `bun test` passes | Exit code |
| `filesChanged.length > 0` | `server.ts` was modified | `git diff --name-only HEAD` |
| `agentDispatched` | Dispatch gate forced Agent use | PostToolUse tracker |
| `e2eEvidence` | Orchestrator ran the server (matched `E2E_CMD` regex) | PostToolUse tracker |
| `artifactCreated` | Orchestrator saved output (matched `ARTIFACT_CMD` regex) | PostToolUse tracker |
| New events in dev DB | Real hooks wrote to `.dev/data/signals/hook-events.jsonl` | Line count delta |
| Dispatch gate fired | `dispatch-pre-require-subagent` events in recent entries | JSONL filter |
| Quality gate engaged | Marker was written then cleared (or still exists) | `require-e2e` file |
| Bare: task succeeded | Baseline completes without hooks | Exit code |

**Telemetry in dev UI:** Hook events are written to `.dev/data` so they appear in the Construct observability dashboard at `/observability/hooks`. The `dispatch-pre-require-subagent` and `routing-submit-classify` entries in the hooks table include events from eval runs.

### `runner.ts`

Multi-trial A/B runner. Runs N trials comparing `with-hook` (quality gate Stop hook + verification prompt) vs `bare` (no hooks). Saves results as JSON to `src/eval/results/`.

### Shared infrastructure

| File | Purpose |
|---|---|
| `harness.ts` | Sandbox setup (`setupSandbox`), Agent SDK runner (`runEval`), real hook delegation (`realHookCallback`, `realStopHookCallback`), tool classification (`classifyToolCall`), assertions (`check`, `printAndExit`), telemetry I/O (`readHookEvents`, `writeHookEvent`), transcript builders (`userMsg`, `assistantMsg`) |
| `patterns.ts` | Detection regexes shared by evals and hooks: `E2E_CMD` (playwright, cypress, devserver), `ARTIFACT_CMD` (screenshot, output redirect), `UNIT_TEST_CMD` (bun test, jest — excluded), `HOOK_INVOCATION` (hook scripts — excluded) |

## Eval scenarios (`src/eval/scenarios/`)

| Scenario | Server | Bugs | What it tests |
|---|---|---|---|
| `broken-math` | None | `median()` uses lexicographic sort | Simple bug fix, no server to verify against |
| `todo-app` | HTTP on port 3847 | Toggle always sets `done=false`; POST returns 200+empty instead of 201+todo | Bug fix with real server for e2e verification |
| `todo-feature` | HTTP on port 3847 | None (feature addition) | Adding due date field, overdue filter, sort, date picker UI |

## Coverage gaps

- **Git hooks** (`git-pre-require-commit.ts`) — no tests
