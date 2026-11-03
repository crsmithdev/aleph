# Kept goal-added tests outside jobs/

Measured 2026-11-03 on origin/main 7071c45292 (the tests themselves were classified at b8f7bb5e35; the files outside jobs/ did not change between them except hooks/verify-gate.test.ts, whose new case has no Job trailer). The scope is every `*.test.ts` file outside `jobs/`.

## Method

- **Goal-added case.** For each `test(` line, `git log --reverse -S<title>` over the test files gives the commit that first added the title. This follows moves and splits across files. A case is goal-added when that commit has a `Job:` trailer. `git blame -C -C -M` agrees on all but 11 cases; the 11 are moves or splits, where the title search is right.
- **Reason 1, proven regression.** For each goal commit that fixed a bug (judged from its subject), the commit's tree was extracted, the cases it added were run, then its product files (not tests, fixtures or docs) were set back to the parent's and the cases were run again. A case is proven when it passes at the commit and fails after the revert. One case is kept per bug. The runs had `HOME` and every `ALEPH_*` path in a temporary folder.
- **Reason 2, only check of a branch.** Bun line coverage cannot see an unrun `?:` arm, so each product file was instrumented: every statement, `if` arm, `?:` arm, `&&`/`||`/`??` right side and concise arrow body records an id. Child processes record too. Each land test file ran whole, and each goal case's file ran again with that case skipped. A case's points are the points its file reaches only when it runs, minus the points of every other land test file. Two runs gave the same result. A point in `ui/views/*.js` or another render helper counts only when it is behaviour (an action offered, a route, a sort, a filter, an alert), not wording, markup or CSS.
- **Joint check.** After the move, the instrumented land suite ran again. Where a behaviour point that no kept case reached was lost, one moved case that reaches it was put back (evidence says so).
- **Reason 3, wiring.** The single land case that runs a command or requests a route.

## Counts

| | Cases |
|---|---|
| Goal-added cases | 466 |
| Kept, reason 1 | 38 |
| Kept, reason 2 | 149 |
| Kept, reason 3 | 2 |
| Kept as setup of a kept case | 1 |
| Moved to `acceptance/` | 276 |
| Deleted as exact duplicates | 0 |
| `bun run test` before | 1527 tests, 32.8 s |
| `bun run test` after | 1232 tests, 25.0 s |
| `bun run accept` after | 642 tests (9 skipped without ALEPH_BROWSER_TESTS=1); 345 before |

## Not checked, or lost on purpose

- `ui/actions.test.ts` "POST /api/wait reads the issue from 'on'" (27bfe05371): its file does not run at that commit, so reason 1 was not checked. It stays for reason 2.
- 04af7f4479 (window picker without a hash): its cases fail after the revert only because `parseHash` does not exist, so they are not counted as proven. One stays for reason 2.
- Reverts were run only for commits whose subject names a fix. A fix that reads as a feature was not checked.
- `ui/fixtures.test.ts` "the review fixture gives the one-off server jobs ..." moved: it reaches `ui/api/memory-types.ts` and `jobs/lib/stage.ts:118` (the flake tracker stage) only through a server child process. No land case reaches those points now. An in-process case of `memoryTypes` would cover them.
- `ui/server.test.ts` "binds 127.0.0.1" moved: it checks a setting, not a branch, and fixed no bug. It is the only check that the server listens on the loopback address only.
- Lost points that are wording or markup: `ui/views/*.js`, the text helpers of `ui/lib.js` (`money`, `diffHtml`, `wkText`, `loading`), the sentence text of `ui/asks.ts`, `ui/api/speed.ts:589` (a cut reason ends at a word) and the Retry-After part of the usage log line.

## Kept cases

| File | Case | Added by | Reason | Evidence |
|---|---|---|---|---|
| hooks/hooks.test.ts | a 500 on page 3 throws | 920bcbb8ee | 2 | hooks/lib/otlp.ts:147 |
| hooks/hooks.test.ts | ${name}: fails at import -> exit 2, named on stderr | 55f27e191f | 1 | reverting 55f27e191f's product change fails it |
| hooks/hooks.test.ts | ${name}: a syntax error in the guard -> exit 2, named on stderr | 1e233c2422 | 1 | reverting 1e233c2422's product change fails it |
| hooks/hooks.test.ts | git-guard: allow exits 0 with empty stderr, deny exits 0 with the deny JSON | 1e233c2422 | 2 | hooks/git-guard.ts:24 |
| hooks/hooks.test.ts | secret-scan: allow exits 0 with empty stderr, deny exits 0 with the deny JSON | 1e233c2422 | 2 | hooks/secret-scan.ts:36 |
| hooks/lib/docclaims.test.ts | a cited file:line no output shows is named, one shown is not | 0e6f8334f8 | 2 | hooks/lib/docclaims.ts:130 (&& arm) |
| hooks/lib/docclaims.test.ts | a code file named with no tool call on it is named | 0e6f8334f8 | 2 | hooks/lib/docclaims.ts:105 (\|\| arm) |
| hooks/lib/hashes.test.ts | keeps the prompt, tool results and tool inputs, and leaves out assistant prose | 7f257749b3 | 2 | hooks/lib/hashes.ts:24: no case left in the land suite reaches it once the other cases move |
| hooks/lib/pricing.test.ts | haiku 5.5 tier is per request by prompt size | 50f301f93e | 2 | hooks/lib/pricing.ts:44 (&& arm) |
| hooks/obs-task-type.test.ts | Jev gets one choice question with eight options over the prompt and final message, and its top option tags the trace | a4c0aafe9f | 2 | hooks/obs.ts:136 |
| hooks/vault-recall.test.ts | no note above 0.7: no output | bcd3b37b31 | 2 | hooks/vault-recall.ts:107: no case left in the land suite reaches it once the other cases move |
| hooks/vault-recall.test.ts | with ALEPH_JUDGE=haiku: no output and Jev is not asked | bcd3b37b31 | 2 | hooks/vault-recall.ts:82: no case left in the land suite reaches it once the other cases move |
| hooks/vault-recall.test.ts | 60 matching notes: at most 40 questions, at most 3 injected | bcd3b37b31 | 2 | hooks/vault-recall.ts:100: no case left in the land suite reaches it once the other cases move |
| hooks/vault-recall.test.ts | no matching note: a span with candidates 0 and no Jev request | f3a08a01b5 | 2 | hooks/vault-recall.ts:88 |
| hooks/vault-recall.test.ts | a failing Langfuse changes nothing the hook prints | f3a08a01b5 | 2 | hooks/lib/otlp.ts:90 |
| hooks/verify-gate.test.ts | changes when the contents of an untracked file change | 930a84d49f | 1 | reverting 930a84d49f's product change fails it |
| todo/cli.test.ts | aleph issue is the only command: aleph todo is gone | a2cae3903e | 2 | jobs/cli.ts:531 |
| todo/cli.test.ts | hidden copies files into the store as one commit, lists them, and show counts them | 53df6a1592 | 3 | 'aleph issue show' and 'aleph issue hidden' (jobs/cli.ts:217-226, 258-270) |
| todo/lib/issues.test.ts | add, note and done | 2c6936d388 | 2 | todo/lib/triage.ts:20 (if arm) |
| todo/lib/issues.test.ts | an unknown issue number is refused | 2c6936d388 | 2 | todo/lib/issues.ts:54 (if arm) |
| todo/lib/issues.test.ts | drop needs a reason | 2c6936d388 | 2 | todo/lib/issues.ts:213 (if arm) |
| todo/lib/issues.verbs.test.ts | aleph issue lint reads a dotted goal file and names it by its dotted id | a36a121b33 | 1 | reverting a36a121b33's product change fails it |
| todo/lib/issues.verbs.test.ts | lint refuses an after ref that is not <repo>-<n>[.<k>] | e35dfccf24 | 2 | todo/lib/todo.ts:257 |
| todo/lib/store.test.ts | a part of a parked parent is not buildable; reopen keeps the parent parked | 1526f6dcef | 2 | todo/lib/store.ts:368 (&& arm) |
| todo/lib/store.test.ts | a list, a lone label, and none | 6893b49e88 | 2 | todo/lib/todo.ts:78 (\|\| arm) |
| todo/lib/store.test.ts | goals come critical first, then by repo and number; an unknown priority ranks as medium | 530326f531 | 2 | todo/lib/store.ts:291 (? arm) |
| todo/lib/store.test.ts | note says why when there is no such item or no list, and writes nothing | 6893b49e88 | 2 | todo/lib/store.ts:333 (if arm) |
| todo/lib/store.test.ts | closeAndFile starts a list the store has none for, and names an item it lacks | 6893b49e88 | 2 | todo/lib/store.ts:397 (: arm) |
| todo/lib/store.test.ts | file adds issues with their bodies; nothing to file writes nothing | 6893b49e88 | 2 | todo/lib/store.ts:415 (: arm) |
| todo/lib/store.test.ts | sort changes an open, unsorted item only | 6893b49e88 | 2 | todo/lib/store.ts:354 (if arm) |
| todo/lib/store.test.ts | flakeTracker picks the lowest open id | f0fe094a79 | 2 | todo/lib/store.ts:424 (=> arm) |
| todo/lib/store.test.ts | editing a parent's priority sets it on its open parts, not its done ones, in one commit | 50ccb02382 | 2 | todo/lib/issues.ts:34 (if arm) |
| todo/lib/store.test.ts | addPart stores agent, or the parent's source when it is not chris; a part with none stored reads agent | c91dc099d3 | 1 | reverting c91dc099d3's product change fails it |
| todo/lib/triage.test.ts | labels and duplicates at p >= 0.7 | 5ac5293dd7 | 2 | todo/lib/triage.ts:34 (=> arm) |
| ui/actions.test.ts | POST /api/wait 400s without a blocker or an item | 60abae762a | 2 | ui/api/actions.ts:56 (: arm) |
| ui/actions.test.ts | POST /api/wait reads the issue from 'on', and the integer part of a goal's dotted 'on' | 27bfe05371 | 2 | ui/api/actions.ts:67 (POST /api/wait drops the job): no case left in the land suite reaches it once the other cases move |
| ui/actions.test.ts | POST /api/wait is 422 when the edit is refused, and drops nothing | a2cae3903e | 2 | ui/api/actions.ts:64 |
| ui/actions.test.ts | a POST without the header, or from another origin, is 403 and runs nothing | 60c6654fda | 2 | ui/api/actions.ts:29 (if arm) |
| ui/actions.test.ts | POST /api/drop passes the reason | 60c6654fda | 2 | ui/api/actions.ts:33 |
| ui/actions.test.ts | a name not in the ledger is 404 and runs nothing | 60c6654fda | 2 | ui/api/actions.ts:30 (if arm) |
| ui/actions.test.ts | GET /api/diff is the branch's diff from the merge base | 60c6654fda | 2 | ui/api/actions.ts:25 (: arm) |
| ui/actions.test.ts | the controls without the header are 403, running nothing | 6a59a66b97 | 2 | ui/api/controls.ts:14 (: arm) |
| ui/actions.test.ts | POST /api/answer/:name drops the question run with the answer as its reason, and refuses anything else without running the CLI | 887688c314 | 2 | ui/api/actions.ts:40 |
| ui/asks.test.ts | ${reason}: stored situation, effects and recommend reach the entry; none stored keeps the fixed text | 56a98e451a | 2 | ui/asks.ts:54 (? arm) |
| ui/asks.test.ts | a last run that names an open issue is the blocker | 60abae762a | 2 | ui/asks.ts:284 (if arm) |
| ui/auth.test.ts | password gate: login, session across servers, logout | aa8f83e882 | 2 | ui/auth.ts:35 (?? arm) |
| ui/auth.test.ts | loginPage declares an empty icon in its head | 25ec2ac0cd | 1 | reverting 25ec2ac0cd's product change fails it |
| ui/browser.test.ts | at ${w} px the Running and Queued cards share one height, meta row and title font | e7ac823f4e | 1 | reverting e7ac823f4e's product change fails it |
| ui/efficiency.test.ts | goal stats: first-pass share, median fix rounds | 2e346657c8 | 2 | ui/api/speed.ts:456 |
| ui/efficiency.test.ts | a click on a card selects its class | 6c4fa50eba | 2 | ui/lib.js:435 |
| ui/fetch-ttl.test.ts | a write fetches in the foreground even with the cache on, and builds on the fresh origin/main | 7ace696da7 | 1 | reverting 7ace696da7's product change fails it |
| ui/fetch-ttl.test.ts | serve() leaves the cache off: only the UI process turns it on, in its main block | d91baa8a0a | 1 | reverting d91baa8a0a's product change fails it |
| ui/fetch-ttl.test.ts | a background fetch that brings an older remote state cannot move origin/main back | 44b5855988 | 1 | reverting 44b5855988's product change fails it |
| ui/gates-notes.test.ts | log() shows an issue note 'Chris dropped: <reason>' as a You entry on the issue | 3998272d3a | 2 | ui/api/gates.ts:90 |
| ui/gates.test.ts | log collapses a run of identical Gate lines into one with count, first and last time | 981f4cca6e | 2 | ui/api/gates.ts:105 (identical Gate lines collapse): no case left in the land suite reaches it once the other cases move |
| ui/gates.test.ts | a revoke line in tick.log is a You entry on the rule, and an always line stays a Rule entry | 3998272d3a | 2 | ui/api/gates.ts:74 (if arm) |
| ui/gates.test.ts | POST /api/gates/caps refuses a missing header with 403 and bad values with 422, and leaves the file | 00938dc6fb | 2 | ui/api/gates.ts:163 (if arm) |
| ui/gates.test.ts | writing awaiting replaces the old waiting key | 00938dc6fb | 2 | jobs/lib/settings.ts:37 (if arm) |
| ui/issues.test.ts | filters by status and label | 132f23271f | 2 | ui/api/issues.ts:64 (if arm) |
| ui/issues.test.ts | drops the issue through the real CLI and returns its status; an unknown id is 404 | c9a15ea971 | 2 | ui/api/issues.ts:192 (if arm) |
| ui/issues.test.ts | lists runs by on, goals included, and by todo for old runs | f8a383edef | 2 | ui/api/contents.ts:21 (if arm) |
| ui/issues.test.ts | unknown issue and other project are 404 | 132f23271f | 2 | ui/api/issues.ts:98 (&& arm) |
| ui/issues.test.ts | the Status filter defaults to Open, newest first; Any shows every status | c6d5a4b4f8 | 2 | ui/views/issues.js:61 (: arm) |
| ui/issues.test.ts | the header sorts: a query key and direction order the rows | 601054d0a6 | 2 | ui/views/issues.js:68 (? arm) |
| ui/issues.test.ts | turns the spec label into --spec -, and passes title, labels and the text on stdin to 'aleph issue add' | deb704e069 | 2 | ui/api/issues.ts:172 (? arm) |
| ui/issues.test.ts | without the header it is 403, and with a foreign Origin too | 132f23271f | 2 | ui/api/issues.ts:160 (if arm) |
| ui/issues.test.ts | an empty title is 400 and runs nothing | 132f23271f | 2 | ui/api/issues.ts:166 (if arm) |
| ui/issues.test.ts | a project filter keeps it to that project | 132f23271f | 2 | ui/api/issues.ts:168 (&& arm) |
| ui/issues.test.ts | approving an option writes the note, clears the Ask and its fields, and makes no goal | a2cae3903e | 2 | ui/api/issues.ts:207 (if arm) |
| ui/issues.test.ts | an option that waits sets after in the same write as the Ask clears | 427f3bec22 | 2 | ui/api/issues.ts:224 (? arm) |
| ui/issues.test.ts | an old prose note is approved by its recommendation sentence | c4e18a5bcc | 2 | ui/api/issues.ts:228 |
| ui/issues.test.ts | approving a migrated proposal clears the Ask and leaves the issue to triage | a2cae3903e | 2 | ui/api/issues.ts:226 |
| ui/issues.test.ts | ${verb} refuses without the header, 404s an unknown issue and runs the CLI on an item with an ask | 427f3bec22 | 2 | ui/api/issues.ts:300 (if arm) |
| ui/issues.test.ts | an issue that is not waiting for you is a 409 | 687af87cb5 | 2 | ui/api/issues.ts:309 (if arm) |
| ui/issues.test.ts | lists as status parked; the filter offers it and narrows to it; the badge differs; it is neither open nor closed | c4044670f3 | 2 | ui/api/issues.ts:109 |
| ui/issues.test.ts | renderIssue shows one row with the situation, effects and buttons, and no ask fields in the front matter | b98dfe15a2 | 2 | ui/api/issues.ts:146 (an asking issue's ask): no case left in the land suite reaches it once the other cases move |
| ui/issues.test.ts | a wait with hold records of the issue's job in its span says the reason and its minutes | e066cc0260 | 2 | ui/views/issues.js:542 (=> arm) |
| ui/jobs.test.ts | the job's state is the run that counts; the run list keeps the land | a897a59b36 | 1 | reverting a897a59b36's product change fails it |
| ui/jobs.test.ts | filters by repo, state and days | 77ee7283ec | 2 | ui/api/jobs.ts:142 (&& arm) |
| ui/jobs.test.ts | ?project narrows to one project | 77ee7283ec | 2 | ui/api/jobs.ts:142 (&& arm) |
| ui/jobs.test.ts | a rename between two requests shows in the second | e248d61d11 | 1 | reverting e248d61d11's product change fails it |
| ui/jobs.test.ts | 404 for an unknown name, or another project's job | 77ee7283ec | 2 | ui/api/jobs.ts:155 (if arm) |
| ui/jobs.test.ts | the job and its diff are the newest job's | 7a94389314 | 1 | reverting 7a94389314's product change fails it |
| ui/jobs.test.ts | lists the known logs with sizes, serves them whole or as a transcript, and refuses other names | b571a45965 | 2 | ui/api/jobs.ts:192 |
| ui/jobs.test.ts | a landed job sealed with scenarios shows the sealed look and the scenarios in checkedBy | ea09d08713 | 2 | ui/api/jobs.ts:108 (?? arm) |
| ui/jobs.test.ts | a dropped job's kept diff.patch is served when the branch is gone; none recorded says so | 3be5215d96 | 2 | jobs/lib/jobdiff.ts:53 |
| ui/jobs.test.ts | 404 when the branch is gone, or the job unknown | 77ee7283ec | 2 | ui/api/jobs.ts:184 (if arm) |
| ui/jobs.test.ts | the list shows jobs with filters, and an empty state | 77ee7283ec | 2 | ui/views/jobs.js:80 |
| ui/jobs.test.ts | the list reads the route query from its argument | bd81a7873e | 2 | ui/views/jobs.js:22 (if arm) |
| ui/jobs.test.ts | reads sent back while a later worker run follows, stuck when it is the last | c26c10ff8a | 1 | reverting c26c10ff8a's product change fails it |
| ui/lib.test.ts | md renders a heading, a list, code and a link | 1eac80cadb | 2 | ui/lib.js:129 (&& arm) |
| ui/lib.test.ts | mountView calls mount only when the view has one | 81daea7de7 | 2 | ui/lib.js:145 (if arm) |
| ui/lib.test.ts | failMessage shows the reason from the body | fc8888075a | 2 | ui/lib.js:62 |
| ui/lib.test.ts | recordState and restoreState bring back open details, a shown diff and typed text | 33cc191f68 | 2 | ui/lib.js:242 |
| ui/lib.test.ts | restoreState ignores state for elements the new HTML no longer has | 33cc191f68 | 2 | ui/lib.js:240 (if arm) |
| ui/lib.test.ts | idLink and pageHead | f132280cfc | 2 | ui/lib.js:85 (safeHref refuses a javascript: URL): no case left in the land suite reaches it once the other cases move |
| ui/memory.test.ts | ?project= keeps only that project's data | b55617017b | 2 | ui/api/memory.ts:158 (? arm) |
| ui/memory.test.ts | a note has its links and backlinks; a missing note is 404 | 2b1ced6e22 | 2 | ui/api/memory.ts:170 (\|\| arm) |
| ui/memory.test.ts | the views render and the note route is wired | 2b1ced6e22 | 2 | ui/views/memory-note.js:10 (the note view's API route) |
| ui/memory.test.ts | facts runs fill the gates section, newest first, scoped by project | b8800ca5f4 | 2 | ui/api/memory.ts:106 |
| ui/memory.test.ts | failed loads are kept for the TTL: no second spawn, no second Langfuse request | 852c1c5772 | 1 | reverting 852c1c5772's product change fails it |
| ui/memory.test.ts | prospective issues carry their priority, medium when they have none, and the page shows the badge | 977d8791a3 | 2 | ui/api/memory-types.ts:136 (?? arm) |
| ui/now-awaiting.test.ts | an old prose note gets a Problem with no tag or lead, Approve recommendation and Deny | 427f3bec22 | 2 | ui/asks.ts:159 |
| ui/now-awaiting.test.ts | the deny and answer inputs render hidden | c63802dd0d | 2 | ui/views/now.js:327 (the answer input of an answer action): no case left in the land suite reaches it once the other cases move |
| ui/now-page.test.ts | a card has no trend without a baseline or with a zero baseline of a count | 65d9379976 | 2 | ui/views/speed.js:124 (? arm) |
| ui/now-page.test.ts | mountStatus loads the window of the address | 8b8d68593e | 2 | ui/lib.js:415 (&& arm) |
| ui/now-proposals.test.ts | approve and decline handlers | 1e8a8fa3aa | 2 | ui/api/proposals.ts:16 |
| ui/now-status.test.ts | an alert keeps its red sentence and holds the weekly usage part; three alerts cut it | bd842d0cf0 | 2 | ui/views/now.js:122 |
| ui/now-status.test.ts | the status sentence wraps instead of clipping: .lede .say has no ellipsis or hidden overflow, and wraps | a1cd4bb0ad | 1 | reverting a1cd4bb0ad's product change fails it |
| ui/now-status.test.ts | the out-of-date part comes first and survives MAX_SAID | 9835184869 | 2 | ui/views/now.js:125 (the out-of-date alert): no case left in the land suite reaches it once the other cases move |
| ui/now-status.test.ts | a dead factory tick says the alert, in red | 3e7517a7ea | 2 | ui/views/now.js:249 (the tick-stopped alert): no case left in the land suite reaches it once the other cases move |
| ui/now-times.test.ts | a build run is a worker and is past the time box after 40 minutes | 3aea34f78b | 1 | reverting 3aea34f78b's product change fails it |
| ui/now-times.test.ts | the Pause or Resume button sits in the page head beside the time; no Controls panel | 0dfbd59659 | 2 | ui/views/now.js:347 |
| ui/now-times.test.ts | message and diff text are escaped | cad2504ab8 | 2 | ui/views/now.js:304 (the Diff action of a run): no case left in the land suite reaches it once the other cases move |
| ui/now-times.test.ts | Status times use the state's own now for the year check | f48b6049ba | 1 | reverting f48b6049ba's product change fails it |
| ui/server.test.ts | /api/state?project= keeps only that project's jobs | 1eac80cadb | 2 | ui/api/now.ts:12 |
| ui/server.test.ts | /api/projects/keys lists the registry's repos | 1eac80cadb | 2 | ui/api/projects-keys.ts:6 (=> arm) |
| ui/server.test.ts | a new view file and api file are served with no edit to server.ts | 1eac80cadb | 2 | ui/server.ts:110 (if arm) |
| ui/server.test.ts | /vendor/echarts.min.js is the vendored ECharts, served as JavaScript | 95779b5608 | 2 | ui/server.ts:116 (if arm) |
| ui/server.test.ts | other paths are 404 and writes are refused | c81dea768e | 2 | ui/server.ts:120 |
| ui/server.test.ts | x-aleph-login is on every API answer behind the gate, and absent without a password | a0fb4207c3 | 2 | ui/auth.ts:90 (if arm) |
| ui/server.test.ts | x-aleph-version changes when a page file changes, is added or is removed | ccdbf3c1e8 | 1 | reverting ccdbf3c1e8's product change fails it |
| ui/sessions.test.ts | the project filter narrows every route | 2274667b23 | 2 | ui/api/sessions.ts:25 (\|\| arm) |
| ui/sessions.test.ts | a turn is a tree of tools, hook spans and errors | 2274667b23 | 2 | ui/api/sessions.ts:278 (? arm) |
| ui/sessions.test.ts | a subagent's span and tools nest under the Agent tool span that launched it | 891ea18a08 | 2 | ui/api/sessions.ts:16 (: arm) |
| ui/sessions.test.ts | the waterfall at 390 px: the detail pane stacks under a grid that scrolls in a short box | 1667635b66 | 1 | reverting 1667635b66's product change fails it |
| ui/sessions.test.ts | the Turn page uses pageHead, idLink and when | dcb62b808b | 2 | ui/api/sessions.ts:278 |
| ui/sessions.test.ts | the chat route gives whole prompts and replies and each turn's tool calls in order | efbe869f77 | 2 | ui/api/sessions.ts:239 (if arm) |
| ui/sessions.test.ts | argSummary picks the key argument, also out of cut JSON | efbe869f77 | 2 | ui/api/sessions.ts:89 |
| ui/sessions.test.ts | the chat is the default: messages in Markdown, folded tool calls, one turn line, a toggle | efbe869f77 | 2 | ui/views/session.js:263 (chat or table API) |
| ui/sessions.test.ts | generations: listed apart from tools with model, offsets, parent and cost; the waterfall draws them as rows | 9a171ef190 | 2 | ui/api/sessions.ts:74 (=> arm) |
| ui/skills.test.ts | ?project= that is no registry key is no filter | 76f3998b41 | 1 | reverting 76f3998b41's product change fails it |
| ui/skills.test.ts | a 502 goes out only after every request of the failed fetch has ended | e426aea61f | 1 | reverting e426aea61f's product change fails it |
| ui/skills.test.ts | after a restart, a reload fetches only the rows of the last two hours and keeps the older ones | 594a8220a5 | 2 | ui/api/skills.ts:141 |
| ui/skills.test.ts | a project tag with no cwd counts only when it is a registry key | cbc911ae8d | 1 | reverting cbc911ae8d's product change fails it |
| ui/skills.test.ts | the skill detail uses section heads and fit tables | b5f3e9f134 | 3 | GET /api/skills/:name (ui/api/skills.ts:313); no other land case requests it |
| ui/specs.test.ts | /api/specs/:project/:file gives the body; unknown or unsafe names are 404 | 87380328ef | 2 | ui/api/specs.ts:32 (if arm) |
| ui/specs.test.ts | the spec page renders the Markdown, escaping HTML | 87380328ef | 2 | ui/views/spec.js:10 (the spec view's API route) |
| ui/speed.test.ts | done and issues.landed count landed issues, not land runs | 051c15705a | 1 | reverting 051c15705a's product change fails it |
| ui/speed.test.ts | GET /api/speed takes a window (default week) and answers JSON | 91534580f2 | 2 | ui/api/speed.ts:575 (?? arm) |
| ui/speed.test.ts | classify: one run of each class, with its cause | f99e80e721 | 2 | ui/api/speed.ts:190 (if arm) |
| ui/speed.test.ts | a build run counts as an agent run | cb5af2b65f | 1 | reverting cb5af2b65f's product change fails it |
| ui/speed.test.ts | classify: a drop's fate, not its prose, sets the nothing class and the Needed Chris cause | f51a792bfd | 1 | reverting f51a792bfd's product change fails it |
| ui/speed.test.ts | runs read their issue from on: a part counts under its own ref, an issue run under its number | b8661934fb | 1 | reverting b8661934fb's product change fails it |
| ui/speed.test.ts | an unlanded run of an issue that left the store is Dropped | 246f552290 | 1 | reverting 246f552290's product change fails it |
| ui/speed.test.ts | activeEnd pulls ended back to the last worker activity | 230f8398fd | 2 | jobs/lib/process.ts:102 (if arm) |
| ui/speed.test.ts | flakes count each test name; a row without tests counts under its check | 542e80ac43 | 1 | reverting 542e80ac43's product change fails it |
| ui/speed.test.ts | serve() warms /api/speed: week, day and month are computed before the first request | 9d8dea36b1 | 2 | ui/api/speed.ts:361 (\|\| arm) |
| ui/state.test.ts | triage lists running runs first, then finished ones with their outcome, and keeps them out of the jobs lists; issues lists the new ones | cc0ca8507a | 2 | ui/state.ts:360: no case left in the land suite reaches it once the other cases move |
| ui/state.test.ts | landing counts land runs in progress; New counts open unlabelled issues, not goals or labelled ones | 4180498bf3 | setup | the kept case 'delivered holds the 10 latest lands' reads the land run fac-8 it writes |
| ui/state.test.ts | factory.liveRuns counts live agent runs only; land and plan runs stay in running | 78283c1781 | 1 | reverting 78283c1781's product change fails it |
| ui/state.test.ts | trailers: a landed job's from its commit, an awaiting job's as the land will write them | 47e2a1668f | 2 | ui/state.ts:200 (? arm) |
| ui/state.test.ts | does not make the job stuck, in the UI or in the facts | c3a821908a | 1 | reverting c3a821908a's product change fails it |
| ui/state.test.ts | counts as running and takes its goal out of waiting; triage does not; a done one does neither | d1d817fa01 | 1 | reverting d1d817fa01's product change fails it |
| ui/state.test.ts | lists under Needs you, and not under Queued or Done, though a trailer commit on main names it | f588add342 | 2 | ui/state.ts:417: no case left in the land suite reaches it once the other cases move |
| ui/state.test.ts | a next elapse is the next tick | 29d3c10413 | 2 | ui/state.ts:155 (? arm) |
| ui/state.test.ts | no next elapse and the service failed or inactive is a dead timer | 29d3c10413 | 2 | ui/state.ts:159 (\|\| arm) |
| ui/state.test.ts | systemctl failing gives null and false | 29d3c10413 | 2 | ui/state.ts:144 (if arm) |
| ui/stuck-contrast.test.ts | ${block.name} block meets 4.5:1 | 500b06ff32 | 1 | reverting 500b06ff32's product change fails it |
| ui/timeline.test.ts | ends a hold at a started record | 5b34c1d75d | 2 | ui/timeline.js:98 (? arm) |
| ui/timeline.test.ts | reads Waited N min. with no records | 5b34c1d75d | 2 | ui/timeline.js:112 (: arm) |
| ui/usage.test.ts | the window starts at the last reset | 402056894c | 2 | ui/usage.ts:123 (if arm) |
| ui/usage.test.ts | under 6 hours of snapshots there is no share | 402056894c | 2 | ui/usage.ts:158 (if arm) |
| ui/usage.test.ts | r is the rise per dollar, per model when it has $5, pooled otherwise | 402056894c | 2 | ui/usage.ts:177 (=> arm) |
| ui/usage.test.ts | gainSince: the latest weekly percent minus the snapshot nearest to 5 hours before, in the reset window | 2e346657c8 | 2 | ui/usage.ts:255 |
| ui/usage.test.ts | a 429 without Retry-After logs the status alone | 127fea691e | 2 | ui/usage.ts:63 (a poll that is not HTTP 200): no case left in the land suite reaches it once the other cases move |
| ui/usage.test.ts | a credentials file with no token logs one line | 127fea691e | 2 | ui/usage.ts:53 (if arm) |
| ui/usage.test.ts | a body that is not JSON logs one line and not the body | 127fea691e | 2 | ui/usage.ts:70 |
| ui/usage.test.ts | a JSON body with no usage numbers logs one line | 127fea691e | 2 | ui/usage.ts:73 (if arm) |
| ui/usage.test.ts | a reply with ${name} five_hour gives a null five_hour snapshot | 6e27d02090 | 1 | reverting 6e27d02090's product change fails it |
| ui/usage.test.ts | readSnapshots keeps a null or missing five_hour as null and a number as is | 6e27d02090 | 2 | ui/usage.ts:111 (?? arm) |
| ui/usage.test.ts | a network failure logs one line | 127fea691e | 2 | ui/usage.ts:60 |
| ui/usage.test.ts | summary ignores a row dated after the clock, so a future-dated snapshot does not stick as the latest | 2133d37f5e | 1 | reverting 2133d37f5e's product change fails it |
| ui/usage.test.ts | under bun test a poll without ALEPH_USAGE_FILE writes no file, so a test cannot leave a row in the real ~/.aleph/usage.jsonl | 2133d37f5e | 2 | ui/usage.ts:84 (if arm) |
| ui/usage.test.ts | a snapshot dated after the clock does not skew currentFit() or fit() | c74f5879e9 | 1 | reverting c74f5879e9's product change fails it |
| ui/window.test.ts | picking an option on each page asks for that window and the page says its period | 2c420f3b16 | 2 | ui/lib.js:391 |
| ui/window.test.ts | the window stays when the reader moves to another page, and an address beats the store | 2c420f3b16 | 2 | ui/lib.js:409 |
| ui/window.test.ts | All jobs keeps an old ?days= address open | 2c420f3b16 | 2 | ui/views/jobs.js:10 |
| ui/window.test.ts | the route of #?window=day is Status, on the day window | 04af7f4479 | 2 | ui/lib.js:374 (parseHash of #?query): no case left in the land suite reaches it once the other cases move |
| ui/work-model.test.ts | the Always list is always.json under the new reasons | ed7de3d8d5 | 2 | ui/state.ts:470 (?? arm) |
| ui/work-model.test.ts | a goal's page names its issue and has no goals of its own | ed7de3d8d5 | 2 | ui/api/issues.ts:114 (: arm) |
| vault/lib/git.test.ts | a renamed note keeps the date it first entered git | 74aa218349 | 1 | reverting 74aa218349's product change fails it |
| vault/lib/git.test.ts | commitPaths still commits the note when another named path is gone and was never tracked | 584a24c74b | 1 | reverting 584a24c74b's product change fails it |
| vault/lib/ops.test.ts | without --days the window is 7 days; a wide window counts older calls | f3a08a01b5 | 2 | vault/lib/ops.ts:328 (? arm) |
| vault/lib/ops.test.ts | recallQuery takes cli.ts and vault recall as a command word only | ecc9492ad1 | 2 | vault/lib/recall-query.ts:13 (?? arm) |
| vault/lib/ops.test.ts | consistent_with writes at p 0.9 and the server is not asked about that note | 3778939cb9 | 2 | vault/lib/ops.ts:202: no case left in the land suite reaches it once the other cases move |
| vault/lib/ops.test.ts | consistent_with naming no live note is refused and changes nothing | 3778939cb9 | 2 | vault/lib/ops.ts:202 (if arm) |
| vault/lib/ops.test.ts | a dead Jev writes with a warning | 3caa92000c | 2 | vault/lib/ops.ts:235 |
| vault/lib/ops.test.ts | recall --episodes returns the top 3 | 544ee8a690 | 2 | vault/lib/ops.ts:296 (=> arm) |
| vault/lib/vault.test.ts | consistent_with leaves a note out of screenCandidates and out of the overlap warning | 3778939cb9 | 2 | vault/lib/vault.ts:321 (?? arm) |
