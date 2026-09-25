# Agent jobs: red team record

Written 2026-09-24. This file keeps the evidence and the outcome of three
red-team rounds on [`2026-09-24-agent-jobs.md`](2026-09-24-agent-jobs.md).
**Build from the spec, not from this file.** The solutions that each round
first proposed are in git (`a957880`, `b426a74`, `6df8d5a`); many were later
replaced or cut, and the Outcome column gives the current answer.

## Measured

| Check | Result |
| --- | --- |
| A job change that passed its tests broke main | `e0dd6d1` reverts `2eddeb1`; job `app-queue` merged it; its log says "Nothing has run on a device." |
| `claude --bg` survives the stop of the unit that started it | No. The daemon starts in the caller's cgroup and died with it; the session went to `failed`. |
| `git update-ref` from a worktree | It moves the shared `main`. A regex Bash rule does not catch it. |
| The push block (`pushInsteadOf` through `GIT_CONFIG_*`) | Push fails with exit 128; fetch still works. `-c` or `GIT_CONFIG_COUNT=0` undoes it. |
| `gh` with `GH_CONFIG_DIR` set to an empty folder | `gh auth status` exits 1. Without it, `gh` holds a live token. |
| `timeout` and child processes | It signals the whole process group; a background child died. Exit 124 and 137 do not prove a timeout. |
| An untracked file that a committed file imports | Checks passed, the push worked, a fresh clone failed. |
| A stored base after a rebase | Stale: `git diff base HEAD` listed another clone's files. |
| A leftover `job/<name>` branch | `git worktree add -b job/<name>` fails with "already exists". |
| `worktree remove`, `branch -d` | Refuse untracked files and squash-landed branches; need `--force` and `-D`. |
| Worker permission modes in 61 past commands | 28 in bypass mode |
| Setup artifacts | `corpus`, `node_modules` and `android/local.properties` are already gitignored |
| Remotes | aleph, sidetone and cloudchamber all push to `git@github.com:` |

## Corrections to earlier numbers

| Claim | Correct |
| --- | --- |
| 135 commits on Sidetone main, 21–24 Sep | 152; `--since` had no time |
| 63 agent jobs, 1.46× parallelism | 68 jobs and 1.43× with the wider filter; state the filter |
| Outside studies (habituation, 19.8% conflicts, Claim Plane) | direction only; they do not measure this setup |
| Cross-repo demand | 0 of 68 jobs outside Sidetone; a forecast |

## Findings and outcomes

Round numbers: 1 read version 1, 2 read version 2, 3 read version 3.

| Round | Finding | Outcome in the spec |
| --- | --- | --- |
| 1 | The verify gate judges honesty, not correctness; `e0dd6d1` would pass | Registry checks decide; `manual` globs give `needs-you`; the gate does not decide |
| 1 | Nothing wrote `timed-out`; the time limit killed `finish` | `timeout` around the worker and each check, inside the unit; the unit's clock decides |
| 1 | One branch in two worktrees | One job keeps one worktree; a follow-up is a new run there |
| 1 | A worker could land, push, or skip the gate | Push and `gh` blocked; the unit writes the state after the worker; `skip verify` ignored in jobs; guards, not a sandbox |
| 1 | Races on the cap and the name | A dispatch lock that waits for `pid` |
| 1 | Half-written files | Temporary name, then rename |
| 1 | Land not atomic; dirty main checkout | `commit-tree` on `origin/main`, fast-forward push, local fast-forward only if clean |
| 1 | Secrets in speech | aleph sends one line from fields; the lead speaks, under its own rule |
| 1 | A land has side effects | Cloud Chamber's `post-merge` reloads; Sidetone gets a `note`, no automatic restart |
| 1 | Most of version 1 answered no event | Cut: overlap warning, `--review`, status line, 24-hour reminder, replay, routines |
| 2 | `exit` came before the checks, so a checking run looked lost | The unit writes `exit` last |
| 2 | A regex Bash deny list leaks and blocks normal work | No deny list |
| 2 | A write boundary broke real workers | No write boundary |
| 2 | Land inside the lead's Bash call | Land is a run in its own unit |
| 2 | Plain-command jobs lost their runner | `aleph run` |
| 2 | An env file's `PATH` overrode the dispatcher's | The unit sets `PATH` after the env file |
| 3 | The lead never heard the news | `/tell`: the bridge gives news to the lead at idle (Chris chose this) |
| 3 | Untracked files passed the checks | A clean tree includes untracked files |
| 3 | A failed land blocked landing | The latest agent run decides |
| 3 | No executable; foreground tests broke liveness | `bin/aleph`; foreground runs `aleph unit` as a child |
| 3 | The lead's instructions were missing | The spec holds the `CLAUDE.md` block |
| 3 | A stale base; a leftover branch; names in two repos; a year-less folder name | `merge-base` each time; leftovers removed; unique open names; `YYYYMMDD` folders |
| 3 | Locks held by a reused pid | Locks on `$XDG_RUNTIME_DIR`, a tmpfs a reboot clears |
| 3 | Order of question, uncommitted work and exit codes | One ordered rule in criterion 8 |
| 3 | A follow-up lost the task; check output was lost | `spec.md`, notes, `result.md`, `checks.log`, `land.log` carry over |
| 3 | A second start after a false "rejected" | The lead checks `aleph jobs` first; a 120 s rule was cut |
| 3 | `quiet` for aleph lands had no owner | Cut |

## Accepted limits

- A worker that tries to get around its limits can: `git -c`, its own environment, local refs. Land never pushes from them.
- Four or five checks at once can clash on the GPU or on ports. No clash is recorded.
- A manual Android check waits until Chris can use the phone.
- When Cloud Chamber's main checkout has tracked changes, a land skips the local fast-forward and the reload, and says so.
