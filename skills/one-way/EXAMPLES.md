# Examples

Proven findings from the aleph architecture review of 2026-11-10 (main at da8a19884), each with the signal
that finds it, the proof, the owner, and the commit that made one way. Use them to calibrate step 3 and
step 4, and as the bar for a card.

## Status verdict: three copies

- **Signal**: repeated fixes. c2f79239d, 4cd9e7c98, 567212b56 and 541350925 each fixed one case of the
  same mismatch.
- **Copies**: `ui/state.ts:452` (tone and text for the Herald history), `ui/api/now.ts:30` (patched weekly
  usage into history), `ui/views/now.js:115,256,401` (`renderLede`, then `statusVerdict` regex-parsed the
  page's own HTML to get the verdict back).
- **Disagreement**: tick grace (none on the server, 5 minutes on the page), Asks the director holds
  (counted on the server, dropped on the page), weekly usage and warning health lines.
- **Owner**: `verdict(state, now)` in `lib/status-words.ts`; the server records history from it, the page
  formats its parts. Landed as 681d0e34e.
- **Lint**: `statusVerdict` or a regex over rendered HTML in `ui/views`.

## Directory locks: two implementations

- **Signal**: synonym functions (`lockSync`, `lock`) and twin helpers (two `pidAlive`).
- **Copies**: `jobs/lib/records/record.ts:150` (`lockSync`, frees a stale lock at once) and
  `jobs/lib/records/ledger.ts:282` (`lock`, reclaims under a guard).
- **Disagreement**: two waiters that both see a dead owner can remove the live lock one of them then took.
  `ledger.ts:304` names the race; `record.ts:171` still had it.
- **Owner**: `jobs/lib/infra/locks.ts` with the guarded reclaim. Landed as c5742f10d.
- **Lint**: `mkdirSync(` on a `.lock` path outside `infra/locks.ts`.

## Page scope: two meanings of one parameter

- **Signal**: twin parsers and client and server copies.
- **Copies**: 14 scope functions in `ui/lib.js:426-545` called about 130 times; 17 routes in `ui/api/*.ts`
  that parse `?project` and `?window` by hand, with 8 window tables.
- **Disagreement**: `?window` was a name (`week`) on now, gates and speed, and a number of days on agents,
  skills and sessions.
- **Owner**: client `scope(q)`, server `scopeOf(url)` over one table. Landed as 39c2d150f, 4151318da and
  35f042e8d.
- **Lint**: `searchParams.get("window")` outside `ui/api/scope.ts`.

## Run end: several writers

- **Signal**: twin writers and recomputed state.
- **Copies**: `jobs/lib/records/record.ts:342,352`, `ledger.ts:166-219`, `job.ts:43`,
  `transitions/continuation.ts:156`, `roles/unit.ts:214`, `stage.ts:78`.
- **Disagreement**: `job.lastReal` and `record.next` filtered runs differently; between the condition
  write and the `next` write, a returned run read as `step: "rescue"`.
- **Owner**: the record module owns the run end as one update. Landed as 2f385c342 and 8e8bf1326.

## Redraw: a finding still open at the time

- **Signal**: repeated fixes (e2ac70562, 653fe63c6 fixed lost folds one view at a time).
- **Copies**: `ui/router.js:195` (`draw` restores folds and focus); six views that save state, set
  `innerHTML` and restore by hand, none with `restoreFolds`.
- **Disagreement**: a view redraw drops open folds that a router redraw keeps.
- **Owner**: the router owns every redraw; views return strings.

## Looked alike, not a finding

- `isBuild` and `isAgentRun` in `ledger.ts`: different sets on purpose.
- `dur` and `durMs` in `ui/lib.js`: different ranges and empty values by contract.
- Four `DAY_MS` constants: the same arithmetic, not a policy that can change in one place.
