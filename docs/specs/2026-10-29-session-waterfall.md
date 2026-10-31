# Session waterfall: screenshots

Part of aleph-539.1. The Waterfall view (aleph-537, commits fd3b7512, 9a171ef1) is `#/sessions/<id>?view=waterfall`. This note records the fixture and the shots; the shots showed no defect in the view, so no code changed.

## Screenshots

Taken with `aleph-shot` against `bun ui/server.ts --port 3402` and a stub Langfuse (scratch, not committed):

```
aleph-shot 'http://127.0.0.1:3402/#/sessions/wf-fixture?view=waterfall' <out.png> \
  --width 1440 --height 900 --scheme light|dark --click '.wf-row.err' --wait 3000
```

Server env: `LANGFUSE_BASE_URL` = the stub, `LANGFUSE_PUBLIC_KEY=pk`, `LANGFUSE_SECRET_KEY=sk`, and `ALEPH_REPOS` (`{"aleph":{"path":"<tmp>/aleph"}}`), `ALEPH_JOBS_DIR` (empty dir), `ALEPH_USAGE_FILE` (absent file) all inside a temp dir. `GET /api/sessions/wf-fixture/chat` answered 200 before the shots. The error row is early in the list (index 8) on purpose: clicking a row that is off screen scrolls the page, and the shot tool then captured a half-blank frame.

Each shot shows: one row per call, indented under `Turn 1`; bars placed by start time; the error row in red; the detail pane open on that row with input, error and output; the summary line with the 3 longest calls.

| Image | Width | Scheme | State |
| --- | --- | --- | --- |
| [`waterfall-1440-light.png`](2026-10-29-session-waterfall/waterfall-1440-light.png) | 1440 | light | error row `Edit src/f8.ts` selected |
| [`waterfall-1440-dark.png`](2026-10-29-session-waterfall/waterfall-1440-dark.png) | 1440 | dark | error row `Edit src/f8.ts` selected |
| `waterfall-390-light.png` | 390 | light | pending |
| `waterfall-390-dark.png` | 390 | dark | pending |

## Fixture

A stub `Bun.serve({ port: 0 })` that answers `GET /api/public/traces` (filtered by `sessionId`; only `wf-fixture` has a trace) and `GET /api/public/observations?traceId=...` (`{ data, meta: { totalPages: 1 } }`). Everything is a formula on the index, with no randomness. `BASE = 2026-10-29T10:00:00.000Z`; `NAMES = [Bash, Read, Grep, Edit, Glob]`.

- Trace `wf-trace`, session `wf-fixture`, name `aleph`, timestamp `BASE`, input `run the waterfall fixture`, output `done`, `totalCost` 0.5, `latency` 210, metadata `{cwd:"/w/aleph", task_type:"code_edit"}`. One trace is one turn.
- Root: `AGENT` `wf-turn`, name `turn`, start `BASE`, end = the latest end time of any call.
- 100 `TOOL` observations `wf-t0` to `wf-t99`, each with `parentObservationId: "wf-turn"`. Keep a running `t`, starting at 2000 ms. For call `i`: `t += 1000 + ((7*i) mod 3) * 1000` (a step of 1 to 3 s), then start = `BASE + t`, duration = `200 + ((37*i) mod 79) * 100` ms (200 ms to 8 s; calls overlap).
- Name is `NAMES[i mod 5]`, except `i = 30`, which is `Agent`. Input is the string `src/f<i>.ts`; output is the string `output of call <i>: ` followed by `result line` repeated `1 + (i mod 4)` times, joined by single spaces. For `i = 30` the input is the object `{subagent_type:"Explore", prompt:"survey the fixture"}`.
- Exactly one error: `i = 8` (`Edit`) has `level: "ERROR"` and `statusMessage: "exit code 2: no such file"`.
- Subagent, emitted right after call 30: `AGENT` `wf-sub`, name `Explore`, `metadata {agent_id:"1", agent_type:"Explore"}`, parent `wf-turn`, start = call 30's start + 500 ms, end = call 30's start + 7000 ms. Five `TOOL` children `wf-s0` to `wf-s4`, parent `wf-sub`, name `NAMES[(2*k) mod 5]`, input `sub input <k>`, output `sub output <k>`, start = call 30's start + 1000 + 1000*k ms, duration 800 ms.

Resulting header line: wall 3 min 30 s, tool time 6 min 50 s, longest `Grep(src/f32.ts)` 8.0 s, `Glob(src/f64.ts)` 7.9 s, `Grep(src/f17.ts)` 7.8 s, 1 error.
