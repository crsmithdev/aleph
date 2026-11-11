# UI updater and API cleanup

Status: approved 2026-11-09. Source: the UI API review and red-team of 2026-11-09, and the grill that followed. Related issues: aleph-1625, 1626, 1627, 1628, 1629, 1630, 1631, 1632, 1633. The data-side issues aleph-1639 to 1644 are separate (see Out of Scope).

## Problem Statement

The UI pushes a `change` signal, but freshness is spread over ten caches in seven files, and they disagree:

- A `change` clears the speed caches, and the next request rebuilds them on the main thread. One change with Status open blocks the server for about 2.7 s (measured: `speed()` 300-370 ms for each window, and `baseline("day")` 1,738 ms).
- Caches are cleared only while a page holds a stream, so a tab that returns after an hour shows hour-old numbers.
- The Langfuse cache never drops an entry and grows every hour.
- Every page refetches on every change, whatever changed.
- A failed load is silent: the reason is in the journal or nowhere.

The routes also use old words and inconsistent names:

- `/api/jobs/:name` returns all the attempts on one subject, and `runs/:run` calls an attempt a run.
- `/api/agents` serves the Sessions page.
- Two routes serve a diff.
- Grant and revoke sit in two files.
- POST answers come in five error shapes, and the page shows "Conflict" in place of the reason.
- Project filtering follows nine or more rules.
- Each request parses the job records again: up to 11 passes for one answer.

## Solution

One updater module owns all derived data in the UI server. It watches the files and polls Langfuse for the keys in use. It rebuilds those keys in a Worker, and only then sends a `change` that names the keys. A page refetches only the keys it reads, and the answer is always warm. A key that fails to rebuild keeps its last value and carries a visible mark on every chart and table that reads it.

The routes are renamed to the terms in `docs/naming.md`, with one name for the data and for the page that shows it. Every POST that runs an `aleph` command goes through one module, with one answer shape that always carries the reason. One module decides project scope, and one module builds the issue as the UI sees it. The page router moves out of `index.html` into a module that tests can import. Langfuse has one paging path.

## User Stories

1. As Chris, I want a page to show new data within about 2 s of a change, so that the UI tracks the factory without a reload.
2. As Chris, I want the server to stay responsive while it rebuilds, so that other pages and the stream never stall.
3. As Chris, I want a tab I return to after an hour to show current data at once, so that I never act on old numbers. The exception is Sessions and Skills, whose Langfuse rebuild can take minutes: a return tab shows their last data at once with a note of its age, and the page updates in place when the rebuild ends.
4. As Chris, I want a page to refetch only when data it shows has changed, so that a Langfuse update does not reload Status.
5. As Chris, I want Sessions, Agents and Memory to update live like Status, so that every page behaves the same.
6. As Chris, I want a chart or table whose data failed to rebuild to say how old it is and why, so that a stale number is never silent.
7. As Chris, I want the server's memory to stay bounded however long it runs, so that it does not reach 1.5 GB.
8. As Chris, I want the pages I used before a restart to be warm after it, so that a land does not cause visible waits.
9. As Chris, I want the work store fetched in the background with its errors shown, so that issue data is never silently old.
10. As Chris, I want every route named in current terms, the same as its page, so that the API reads like the UI.
11. As Chris, I want to list all jobs and see the jobs of one issue, so that routine jobs and issue jobs are both reachable.
12. As Chris, I want a job action to act on the exact job the page showed, so that a rerun in between cannot redirect my click.
13. As Chris, I want every failed action to show its reason, so that I never see a bare "Conflict" or "Bad Gateway".
14. As Chris, I want one project filter rule on every route, so that a filtered page counts the same things everywhere.
15. As Chris, I want each answer to carry only its own data, so that big pages load quickly.
16. As Chris, I want every answer's shape checked against a schema, so that a route cannot drift from what the page expects.
17. As Chris, I want every time in every answer in one format, so that charts and tables need no conversion.
18. As the maintainer, I want one place that decides what to rebuild and when, so that freshness bugs have one home.
19. As the maintainer, I want the build to run behind one seam, so that moving a build to its own Worker is a change in one place.
20. As the maintainer, I want the sources a build reads to be recorded automatically, so that a key cannot go stale because a list was wrong.
21. As the maintainer, I want the router testable without Chrome, so that the refetch races have fast tests.
22. As the maintainer, I want a test that sends a gzipped answer through a proxy like home-proxy, so that the 2026-11-09 incident cannot return unseen.

## Acceptance Criteria

1. WHEN a job record is written while Status is open THE system SHALL send `change` naming the affected keys within 3 s of the write, and the refetch SHALL return data that includes the write.
2. WHILE the updater rebuilds any key THE server SHALL answer `GET /api/projects` within 50 ms.
2a. THE day baseline built in one pass SHALL equal the baseline built by the old 7-call method on the same records (a test compares the two).
3. WHEN a page requests a key that was rebuilt after a change, with no stream open at the time THE system SHALL return the rebuilt value, never a value from before that change. The exception is a Sessions or Skills key (`/api/sessions…`, `/api/skills/…`) that has an answer but is due for a rebuild: its request SHALL return that answer at once with `{ error, since }` (`since` the time that answer was built, the error saying a rebuild runs) and start the rebuild, and `change` SHALL name the key when it ends. A key with no answer still waits for its first build.
4. WHEN `change` names only keys that a view does not read THE view SHALL send no request.
5. WHEN a Langfuse poll for a kept key returns an answer whose hash differs from the kept one THE system SHALL send `change` naming that key. WHEN a vault note file changes THE system SHALL send `change` naming the memory keys.
6. IF a rebuild of a key fails THEN THE system SHALL keep the last value, add `{ error, since }` to that key's answer, show "`<name>` is `<age>` old: `<error>`" on every chart and table that reads the key, and send `change` when the key enters and when it leaves the error state.
7. WHEN a key has not been asked for in 1 h THE updater SHALL drop it. WHEN a key has not been asked for in 10 min THE updater SHALL stop rebuilding it on changes and polls.
8. WHEN the server restarts THE updater SHALL start a rebuild of every key in the saved key set at start, without waiting for a request, and a request that arrives during that rebuild SHALL share it.
9. WHILE a work-store key is in use THE updater SHALL fetch origin every 30 s. IF a fetch fails THEN the error SHALL appear as the mark in criterion 6 on the keys that read the store.
10. THE server SHALL serve exactly the routes in the route table below. A request to an old path SHALL return 404.
11. WHEN `GET /api/jobs` is called THE answer SHALL have one row per job (`a1430#2`, `monitor#14`), with routine jobs included, filtered by `project`, `window` and `state`, and paged. WHEN `GET /api/issues/:id/jobs` is called THE answer SHALL list that issue's jobs only.
12. WHEN `POST /api/jobs/:id/drop` names a job that is not the subject's latest job THE system SHALL act on the named job. IF the named job's state no longer allows the action THEN THE system SHALL return 409 with `{ error }` naming the state. THE system SHALL never act on another job.
13. IF any POST fails THEN THE answer SHALL have a 4xx or 5xx status with body `{ error: "<reason>" }`, and THE page SHALL show that reason. A command that exits non-zero SHALL never return 200.
14. WHEN any route is asked for project `p` THE answer SHALL contain exactly the records that the project scope module puts in `p`. IF `p` is not in the registry THEN every route SHALL return an empty result.
15. THE answers SHALL not repeat each other: asks appear only in `/api/automation`, `/api/issues` appears in no other answer, there is no `doneStamps`, and there is one `factory` block. One exception: a prospective item in `/api/memory/search` carries the issue's ID, title and the issue it waits on, and links to the issue.
16. WHEN any route answers THE body SHALL validate against that route's schema. A test runs every route against its schema.
17. THE answers SHALL send every time as an ISO 8601 UTC string, and durations as seconds.
18. THE updater module SHALL be the only code that clears or rebuilds derived data, and the only sender of `change`.
19. THE build SHALL run in a Worker. No build SHALL run on the main thread.
20. WHEN a build reads a source through the path resolvers or Langfuse THE updater SHALL record that source for the key, and a change to that source SHALL rebuild the key.
21. THE router SHALL be a module that `bun test` imports. Every load SHALL go through one path that drops an answer older than the newest answer already shown.
22. WHEN the proxy test forwards a gzipped JSON answer through a `fetch` set up like home-proxy's THE client SHALL decode the JSON.

## Implementation Decisions

### The updater (candidate 3)

- **One updater module** owns every derived value in the UI server. It replaces `ui/stale.ts`, every per-route cache, the four `warm()` exports, the speed `clearCache` hook in the events route, and the store's fetch reuse.
- **Key:** a kind plus its parameters, for example `flow:week:aleph` or `sessions:7`. A route asks the updater for a key and returns its value and mark.
- **Contract of `change`: rebuild, then signal.** When a source changes, the updater rebuilds the kept keys that read it, stores the new values (the old ones are served until then), and then sends `change` with `{ keys: [...] }`. Rejected: clear-then-signal (today, which stalls) and mark-stale-and-wait (every view waits).
- **Kept keys:** keys asked for in the last 10 min are rebuilt on change. Keys not asked for in 1 h are dropped. This is the only size limit, and it applies to Langfuse answers too. Rejected: all 40+ keys (15-30 s of build per change) and fixed defaults (filtered views would always wait).
- **Sessions and Skills keys are served old while due:** a Langfuse cold read can take up to 2 min, so a request for one of these keys that has an answer but is due for a rebuild gets that answer at once with the `{ error, since }` mark, and the page updates in place on `change` when the rebuild ends. Every other key still waits for a build. Chris chose this over keeping the keys warm longer or only speeding the rebuild.
- **First request for a cold key:** it waits for one build, shared by concurrent requests. That build runs in the Worker, so the server does not stall.
- **Restart:** the kept-key set is saved to `~/.aleph/ui/keys.json` when it changes. On start, the updater rebuilds those keys.
- **Builds run in the existing state Worker,** behind one seam. Today the seam has one implementation. Moving flow to its own Worker must be a change to that seam only. Nothing builds on the main thread. Rejected: a second Worker now (rule 5), and a faster main-thread build.
- **Day baseline:** built in one pass over its span, in place of 7 calls of the flow build.
- **Memory keys:** `memory:overview`, `memory:misses` and `memory:items`. `memory:items` is every memory item of every type, built in the Worker. `/api/memory/search` only filters and ranks that value; it never rebuilds it. Today each search rebuilds the items on the main thread, and in a cold process the build did not finish in 120 s (measured 2026-11-09, source not isolated). The four Memory caches (`notes`, `missesCache`, the types cache and the sessions cache) go, and a Memory write does not clear anything: the vault watcher sees the write.
- **Records parsed once per change (R1):** the Worker reads the job records once per change and builds every key from that one copy. Job detail reads only its own record.
- **Source tracking (automatic):** each path resolver (the factory folder, records, events, the work store, the vault, the registry) and the Langfuse `get` calls `touch(<source>)`. While the Worker builds one key at a time, a plain set records what the build touched. The two builds that read through a subprocess (`security-facts` for automation, the vault misses for memory) declare their sources. `layout()` exposes its paths so that a touch marks only the path that was read. Rejected: hand-kept source lists.
- **Sources and triggers:**

  | Source | Trigger |
  |---|---|
  | job records | watcher |
  | factory folder (except `.log`, `.tmp`) | watcher |
  | work store ref `origin/main` | watcher |
  | work store origin | `git fetch` every 30 s while a store key is kept; errors become marks |
  | event log | watcher; `ev` messages stream as today |
  | vault notes | watcher, replacing the 30 s TTL |
  | registry `repos.json` | watcher |
  | Langfuse | poll at 30 s (120 s for skills) while a key is kept; `change` only when the answer's hash differs |

- **Watchers are always on,** whether or not a page holds a stream.
- **Errors:** a failed build keeps the last value and records `{ error, since }`. The mark travels with the key's value in every answer. The page shell and the chart panel show it.
- **Stream:** `/api/events` sends `change {keys}`, `ev`, and `ping`. The `?project=` filter on `change` goes, because the keys carry the project. `ev` keeps its project filter.
- **Page:** each view and each chart panel declares the keys it reads. A view refetches only when `change` names one of them. The 60 s `refresh` timer remains only for text that changes with the clock.

### Routes (renames and R2)

Rule: a URL names the data it returns in the terms of `docs/naming.md`, and the page that shows the data has the same name. An action is a POST under the thing it acts on. Old paths are removed with no aliases.

| Route | Replaces | Data |
|---|---|---|
| `GET /api/factory` | `/api/state` | Status page: factory, live jobs, waiting items |
| `POST /api/factory/pause`, `/resume` | `/api/pause`, `/api/resume` | |
| `GET /api/flow` | `/api/speed` | Flow page (was Efficiency) and the Jobs page charts; `?window=`, `?baseline=1` |
| `GET /api/automation` | `/api/gates` | Automation page: gates, asks, rules, held paths, decision log |
| `POST /api/automation/caps`, `/schedules` | `/api/gates/caps`, `/schedules` | |
| `POST /api/automation/rules/:reason/grant`, `/revoke` | `/api/standing/:reason`, `/api/gates/revoke/:reason` | |
| `POST /api/proposals/:id/approve`, `/decline` | `/api/approve/:id`, `/api/decline/:id` | |
| `GET /api/issues`, `POST /api/issues` | `/api/contents`, `GET /api/issues` | Issues page rows with stage, jobs count and cost; add an issue |
| `GET /api/issues/:id` | `/api/issues/:repo/:n` | `:id` is the short issue ID, `a1430` |
| `GET /api/issues/:id/jobs` | `/api/jobs/:name` | the jobs of one issue; the issue page shows them, and the Work page goes |
| `GET /api/issues/:id/media/:name` | `/api/issues/:repo/:n/media/:name` | |
| `POST /api/issues/:id/{edit,note,media,decide,unblock,drop,retriage,rerun,checked}` | `/api/issues/:repo/:id/*` | |
| `GET /api/jobs` | `/api/jobs` (one row per subject) | one row per job, paged; `?project=`, `?window=`, `?state=` |
| `GET /api/jobs/:id` | | one job, `a1430#2` (sent as `a1430%232`) |
| `GET /api/jobs/:id/diff` | `/api/diff/:name`, `/api/jobs/:name/diff` | |
| `GET /api/jobs/:id/logs/:file` | `/api/jobs/:name/runs/:run/logs/:file` | |
| `POST /api/jobs/:id/{land,recheck,drop,wait,answer}` | `/api/{land,recheck,drop,wait,answer}/:name` | acts on that job only |
| `GET /api/sessions` | `/api/agents` | Sessions page, paged; `?window=` |
| `GET /api/sessions/:id`, `/chat`, `/turns/:n` | unchanged | |
| `GET /api/skills/:name` | unchanged | |
| `GET /api/projects` | `/api/projects/keys`, `/codes` | map of project key to code |
| `GET /api/memory`, `/api/memory/search` | unchanged | |
| `GET /api/memory/notes/:title` | `/api/memory/note?title=` | |
| `GET /api/memory/files/:source/:key` | `/api/memory/file?source=&key=` | a handoff, an episode or MEMORY.md as text |
| `POST /api/memory/notes/:title/{edit,core,alias,link,archive,delete}` | `/api/memory/note/*` | runs `vault write`, `archive` or `delete` through the CLI action module |
| `POST /api/memory/files/:source/:key/{edit,delete}` | `/api/memory/file/*` | |
| `GET /api/specs/:project/:file` | unchanged | |
| `GET /api/models`, `POST /api/models` | unchanged | |
| `GET /api/events`, `GET /api/views`, `POST /api/login`, `/logout` | unchanged | |

- **Query names:** only `?project=` and `?window=` (`hour|day|week|month`, or a day count where a route needs one, named `window` all the same). `?repo=`, `?days=` and `?condition=` go.
- **Page paths** follow the same names: `#/flow` replaces `#/factory/efficiency`, and the Work page goes.
- **No duplication:** asks appear only in `/api/automation`. `/api/factory` drops `doneStamps`, and `/api/automation` drops its second `factory` block. No route embeds another route's answer, and no route calls another route.
- **Paging:** `/api/jobs` and `/api/sessions` take `?limit=` and `?before=`, ordered newest first.
- **Schemas:** each route has a schema, and a test checks every route against it.
- **Times:** ISO 8601 UTC strings everywhere, and durations in seconds. The epoch-ms fields go.
- **The naming doc:** "Speed class" becomes "Flow class".

### CLI actions (candidate 1)

- One module owns "a POST that runs an `aleph` command": the same-site check, the run, the mapping from exit code to status, and the answer shape. Every action route gives it a verb and arguments. Arguments that come from the URL go after `--`.
- Answer: 2xx with the command's JSON on success, or 4xx/5xx with `{ error }` on failure. `postJson` shows `error`, or the text body when the answer is not JSON.
- `wait` and `decide`, which run in-process today, go through the same module. If a step fails, the answer says which step and what persisted.

### Project scope (candidate 2)

- One module answers "is this record in project P" for runs, jobs, issues, events, Langfuse traces, vault notes and skills. Matching is by the registry key, exact, with worktrees mapped to their repo. An unknown project is empty everywhere.
- Memory that applies to every project is in every known project: a note with scope `global`, a rule section, a skill and a hook. The scope module owns this rule, and Memory's own `inScope` goes. An unknown project is empty on Memory too.

### Issue projection (candidate 4)

- One module turns a work-store item plus its jobs into the issue as the UI sees it: the row, the stage, the status and the link. Every route that shows an issue uses it. The issue link is built in `lib/naming.ts`, not by hand.

### Router (candidate 5)

- The page router, load guard, stream client and action dispatch move from the inline script in `index.html` to a module. Every load, whether from a mount, a `change`, the clock timer or after an action, goes through one path that orders answers and drops an older answer.
- A load that a view starts itself goes through the same path: Memory's search, note and file loads. The view's own `shown()` guard then goes.

### Langfuse (candidate 6)

- One paging path: `getAll` uses `allPages` (4 at a time, with retry and a partial flag). The partial flag reaches Sessions and shows as a mark.

## Testing Decisions

- Tests check external behaviour at three seams:
  1. **The server's HTTP interface** (`serve()` on a free port, with fixture stores): routes, schemas, POST answers, project scope, issue projection, paging, times, 404 for old paths, and the proxy test.
  2. **The updater's interface,** with fake sources and a fake clock: rebuild before `change`, keys named in `change`, error marks entering and leaving, expiry at 10 min and 1 h, source tracking, the saved key set warmed after a restart, and the one-pass baseline against the old method.
  3. **The router module,** with a fake `fetch` and a fake `EventSource`: an older answer never overwrites a newer one, a `change` for unread keys sends nothing, and a `change` during input focus is applied after the focus ends.
- The Chrome suite (`ALEPH_BROWSER_TESTS=1 bun test ui/browser.test.ts`) stays for end-to-end checks of the pages.
- Prior art:
  - `ui/server.test.ts` (serve and fixtures, gzip)
  - `ui/events.test.ts` (stream)
  - `ui/fetch-ttl.test.ts`
  - `ui/fixtures.test.ts`
  - `ui/browser.test.ts`
- The server test that pins the exact `/api/state` keys moves to the `/api/factory` schema.

## Out of Scope

These are filed separately and are not part of this work:
- aleph-1639: the event log as the one time series, and the time-series page that builds on it.
- aleph-1640: the old-word migration.
- aleph-1641: stopping `tick.log`.
- aleph-1642: ISO UTC in storage.
- aleph-1643: store retention.
- aleph-1644: run end kept only in the job record.
- aleph-1624: turning on the UI password gate (configuration).
- Changes to home-proxy beyond the `decompress: false` fix of 2026-11-09.
- Rebuilding only the newest bucket of a window.

## Open Questions

None. Each decision in the grill was settled.

## Further Notes

Suggested order:
1. Router module (candidate 5) and the updater (candidate 3), because the other parts depend on keys and ordered loads.
2. Project scope (candidate 2) and issue projection (candidate 4).
3. The CLI action module (candidate 1), together with the route renames and R2.
4. One Langfuse paging path (candidate 6).

Update `docs/design.md` (Live push, Herald stream, chart panels) and `docs/ui.md` in the change that lands each part, not before.

Measured on 2026-11-09:
- `speed()`: week 299 ms, day 315 ms, month 371 ms.
- `baseline("day")`: 1,738 ms.
- `record.all()`: 68 ms, 2,331 records, 5.1 MB.
- `/api/contents`: 1.79 s and about 11 passes over the records.
- `/api/agents`: 4.66 s and 1.5 MB.
- `/api/jobs`: 1.14 MB.
