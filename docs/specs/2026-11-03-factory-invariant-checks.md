# Factory invariant checks

Parked on 3 Nov 2026. Nothing here is built.

## Goal
Find factory bugs from recorded data and stub runs, without a second factory. The plan has five steps, about 5–6 h of agent time, one commit per step. Steps 1 and 2 are independent. Steps 3, 4 and 5 go in that order.

Survey and red team: https://claude.ai/artifact/1tb2MyPjLrwRMBSkKBqFCA. Vault: "A Second Factory On A Separate HOME Is Not Isolated".

These stay as they are: the `Run` schema, `state.json` as the source of truth, the issues store format, the UI API and the factory data flow. These are not part of this plan: a second factory instance, a scratch repo and an AI explorer.

### 1. Parser replay (30 min)
A scratch script runs every `~/.aleph/runs/*/output.log` (2,791 files on 3 Nov) through the parser for its run kind: `parseRoute` (triage.ts:46), `parsePlan` (plan.ts:59), `parseExplain` (explain.ts:162), `parseReply` (firefighter.ts:160), `parseVerdict` (ledger.ts:327) and `parseFacts` (facts.ts:22). It prints each output that a parser refuses, and each output that it reads differently from what the run recorded.

Each real defect gets a fix and one fixture test that holds the real output, through the keep gate. Status gets one health line with the count of parser-failure reasons in `state.json` (47 on 3 Nov: 36 plan titles over 60 characters, 16 with no reviewer verdict).

### 2. Two missing flow tests (20 min)
- A blocker that is dropped or never resolves: the dependent item waits with a reason and does not start.
- An ask answered through the UI API: the item moves on.

### 3. Event log (1–1.5 h)
`writeRun` and `updateRun` (ledger.ts:144-154) also append `{at, run, item, change}` to `factory/events.jsonl`. Pause, resume and hold append to the same file. The 10 callers of `updateRun` stay as they are. Rotation is a follow-up.

### 4. Invariant checker (1.5 h)
The checker reads the log read-only on each tick. It reports on Status only after a violation shows on two consecutive checks, and it files no issues.

| # | Invariant | Past bug |
|---|---|---|
| I1 | No run other than a land starts between a pause and a resume | 1144 |
| I2 | A done item gets no new build run | 336, 458 |
| I3 | A goal has at most one open run | dispatch races |
| I4 | An open run has a live process or started less than 120 s ago | lost runs |
| I5 | An item waits for a named reason, or it moves within 15 min. This includes pause and hold | dead blocker; `stalled()` is blind under pause and hold (factory.ts:485) |
| I6 | An ask has case text within 1 h unless dispatch is held | 1136 |

### 5. Seeded event runs (2 h)
A seed sets 20–50 events: add issue, `tick`, `pause`, `resume`, `dropAs`, kill unit, push to origin. The seed also sets the configuration: how many issues, how many touch the same file, and the stub results (pass, fail, no verdict). The events run through `jobs/lib/flow.testkit.ts` with stub agents. The checker runs after each event. On a violation, the run prints the seed and the event list.

It runs nightly beside `bun run accept` (200 seeds, under 2 min), not in `bun run test`. A failing seed becomes one deterministic test only through the keep gate.

### Limits
Time-based paths use the real clock. About 82 `Date.now()` calls are not injected, so step 5 cannot reach the 15-minute stall or the time boxes. Clock injection and a declared transition table, for coverage, are follow-ups. None of this needs the factory running.

## Edit surface
- Step 1: a scratch script, fixes in the parser files above and their tests, and a Status health line (jobs/lib/factory-status.ts).
- Step 2: jobs/lib/*.flow.test.ts or factory-dispatch tests.
- Step 3: jobs/lib/ledger.ts and jobs/lib/factory-status.ts.
- Step 4: a new jobs/lib/invariants.ts, the tick and its tests.
- Step 5: a new jobs/lib/swarm.ts, its nightly entry and package.json.

## Oracle
- Step 1: the script's report. The health line shows the live count.
- Step 2: each test fails on base or covers a changed line.
- Step 3: a flow test runs one item from triage to land and reads back the expected sequence of events.
- Step 4: one test per invariant gives a hand-made log that violates it and gets the violation. One clean run over the live log since step 3.
- Step 5: a seed that reproduces aleph-1144 fails on 1144's parent commit and passes on main.
