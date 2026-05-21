# Tests

## Test runner

`bun test.ts` — custom runner that pipes JSON into hook scripts and checks stdout. Runs in CI on every push.

## Hook tests (`test.ts`)

| Section | What it covers |
|---|---|
| session-start | Session digest rendering: background work, session counts, last session header |
| rating-capture | Rating extraction from user messages (standalone numbers, "7/10", false positives) |
| session-summary | Correction detection regex, memory extraction from transcripts |
| memory-extract | Memory extraction from transcripts |
| skill routing | Skill routing classifier (debugging, research, verification, docs-review, code-review) |
| modes | Mode loading + frontmatter parser, trigger activation (single/multi/none), INDEX.md drift guard, hook body inlining |
| session recall | Session recall: summarizing past work, detecting unfinished tasks |
| skill extensions | Skill extension injection (code-review, debugging project extensions) |
| trace | Hook tracing output (`[trace:]` lines) |
| quality | Quality hook tests |
| notify | Notify hook tests |
| install preservation | Installer sentinel file preservation across upgrades |
| identity files | Identity files exist, are non-empty, and install correctly |
| directive signals | Directive writing: architectural prompts get `full`, quick prompts skip, questions get `full` only |

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

These are automated CI tests using Playwright directly. For AI-driven verification in Claude Code sessions, use the `code-test` skill instead — it is the canonical front door for interactive e2e verification (and chooses between the agent-browser CLI and Playwright based on task shape).

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
| 2. Start API | Fastify on port 3000 with `CLAUDE_ROOT=~/.claude` | Real JSONL data | HTTP server |
| 3. Start Vite | Dev server on port 5199 proxying `/api` to port 3000 | Vite config | `http://localhost:5199` |
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

### `runner.ts`

Multi-trial A/B runner. Runs N trials comparing `with-hook` (e2e advisory Stop hook + verification prompt) vs `bare` (no hooks). Saves results as JSON to `src/eval/results/`.

### Shared infrastructure

| File | Purpose |
|---|---|
| `harness.ts` | Sandbox setup (`setupSandbox`), Agent SDK runner (`runEval`), real hook delegation (`realHookCallback`, `realStopHookCallback`), tool classification (`classifyToolCall`), assertions (`check`, `printAndExit`), telemetry I/O (`readHookEvents`, `writeHookEvent`), transcript builders (`userMsg`, `assistantMsg`) |
| `patterns.ts` | Detection regexes shared by evals and hooks: `E2E_CMD` (playwright, cypress, cli execution), `ARTIFACT_CMD` (screenshot, output redirect), `UNIT_TEST_CMD` (bun test, jest — excluded), `HOOK_INVOCATION` (hook scripts — excluded) |

## Eval scenarios (`src/eval/scenarios/`)

| Scenario | Server | Bugs | What it tests |
|---|---|---|---|
| `broken-math` | None | `median()` uses lexicographic sort | Simple bug fix, no server to verify against |
| `todo-app` | HTTP on port 3847 | Toggle always sets `done=false`; POST returns 200+empty instead of 201+todo | Bug fix with real server for e2e verification |
| `todo-feature` | HTTP on port 3847 | None (feature addition) | Adding due date field, overdue filter, sort, date picker UI |
| `commit-sequence` | None | None | Two-task feature sequence (`unique<T>` then `flatten<T>` in utils.ts); tests sequential commit workflow across multiple subagent dispatches |
| `e2e-basic` | HTTP on port 3799 | Four arithmetic bugs (add, subtract, multiply, divide all return wrong values) | Bug fix with real HTTP server; tests e2e verification of calculator API |
| `hook-verification-advisory` | None | None | Verifies advisory behavior: QUICK-depth single-file backend edit with no verification should emit advisory without blocking |
| `hook-verification-gate` | None | None | Verifies gate behavior: FULL-depth multi-file change with no verification should be blocked |
| `hook-verification-pass` | None | None | Verifies pass behavior: docs-only edits should pass silently with no hook output |

**Note:** `commit-sequence`, `hook-verification-advisory`, `hook-verification-gate`, and `hook-verification-pass` are scenario definitions only (`.md` or `.yaml` files) with no standalone test runner — they are driven by `runner.ts` or the eval harness. `e2e-basic` has a `server.ts` but no test file.

## Coverage gaps

- **Git hooks** (`git-pre-require-commit.ts`) — no tests
- **`context-compact-suggest` hook** — no tests
- **`security-scan-pre-commit` hook** — no tests
- **`commit-sequence` scenario** — no standalone test file; requires eval runner
- **`e2e-basic` scenario** — has `server.ts` but no test file
