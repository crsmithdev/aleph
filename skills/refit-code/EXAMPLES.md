# Examples

Proven findings, mostly from the aleph architecture review of 2026-11-10 (main at da8a19884), each with the
signal that finds it, the proof, the fix, and the commit that landed it. Use them to calibrate the prove step
and as the bar for a card. Sections are by lens.

# One-way

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

## Redraw: six views redrew by hand

- **Signal**: repeated fixes (e2ac70562, 653fe63c6 fixed lost folds one view at a time).
- **Copies**: `ui/router.js:195` (`draw` restores folds and focus); six views that save state, set
  `innerHTML` and restore by hand, none with `restoreFolds`.
- **Disagreement**: a view redraw drops open folds that a router redraw keeps.
- **Owner**: the router owns every redraw; views return strings. Landed as ba631c570.

# Depth

## Start decision: assembled by hand in three callers

- **Signal**: callers assemble one decision by hand.
- **Locations**: `jobs/lib/gates/issue-decision.ts:21,92`, `jobs/lib/gates/factory-status.ts:185-224`,
  `jobs/lib/transitions/factory.ts:144-201`.
- **Proof**: deleting a shared start module would put the gate order, tier retry and cap back into each caller;
  `stalled()` already skipped the dispatch's tier retry, and the start guard's refusal came back as text matched
  by regex.
- **Fix**: one module returns a typed start or gate; all three call it. Landed as 742213473
  (`jobs/lib/gates/start-decision.ts`).

# Seams

## Issue fields read raw outside the issue module

- **Signal**: raw reads outside the owner.
- **Locations**: about 120 reads of raw frontmatter outside `issues/lib`, e.g. `jobs/lib/roles/intake.ts:247,290`,
  `ui/state.ts:413,418`, `ui/issue.ts:32`.
- **Proof**: each read encodes the field's meaning again; the owner `issues/lib/todo.ts` exists.
- **Fix**: accessors in `issues/lib/todo.ts`; the readers call them. Landed as 71d048577.

# Dead

## Cloud Chamber tidy, 2026-09-27

- **Signal**: knip, pointed at the real entry points.
- **Proof**: the escape-hatch table for each candidate.
- **Fix**: 116 exports lost `export`, 17 dead functions went with their tests, one stale doc reference was
  fixed: −190 net lines over 53 files, landed as 8262b64 in that repo. T1 and T2 only.
- **Lesson**: on aleph, 21 of 23 knip candidates traced to one manifest knip had not been pointed at
  (DETECTORS.md, entry-point blindness).

# Looked alike, not a finding

- `isBuild` and `isAgentRun` in `ledger.ts`: different sets on purpose.
- `dur` and `durMs` in `ui/lib.js`: different ranges and empty values by contract.
- Four `DAY_MS` constants: the same arithmetic, not a policy that can change in one place.
