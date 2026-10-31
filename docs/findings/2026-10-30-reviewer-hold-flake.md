# Reviewer-hold flake under parallel load (aleph-800)

Measured 2026-10-30, 24 cores (`nproc` = 24), on a host already at load average ~140 before the loop started. The aleph-782 wait is commit 5270fe3, which is on main. Before = the test file as of 5270fe3^ (scratch copy of that tree, `node_modules` symlinked). After = this branch (5270fe3 and later).

## Loop

```
seq 1 48 | xargs -P 24 -I{} bash -c 'bun test jobs/cli.reviewer-hold.test.ts > out/run{}.log 2>&1; echo $? > out/run{}.rc'
```

48 runs per tree, 24 at a time. One run alone takes about 28 s and passes. The logs of every run were kept; the loop is not committed.

## Result

| Tree | Passed | Failed |
|---|---|---|
| before (5270fe3^) | 36/48 | 12 |
| after (this branch) | 42/48 | 6 |

Failures by assertion or hook:

| Failure | before | after |
|---|---|---|
| `a stuck or failed run holds the factory only once no next run is pending for it`, `expect(...json.held).toContain("Held: fheldland is failed")` at line 78 of the old file: received `undefined` ("Received value must be an array type, or both received and expected values must be strings") | 1 | 0 |
| first test `a stuck job holds the factory: ...` timed out after 60000 ms (the run that then failed the line above, run12) | 1 | 0 |
| `beforeAll(setup)` hook timed out at 5 s (`openssl req ...` or `git clone -q remote.git other` still running), reported as `(unnamed)` | 11 | 6 |

Total before: 11 hook timeouts + 1 assertion run = 12 failed runs; after: 6 hook timeouts.

## Reading

- The baseline reproduced the flake in the target test once in 48 (2%): the first test's runs were still going after it timed out at 60 s, so the held assertion saw no `held` list.
- After the wait: 0 assertion failures in 48. That is consistent with the wait removing the flake, but 1/48 in the baseline is a weak signal; 0/48 after does not exclude a rate below about 6% (95% bound).
- The file is still not green under this load: 6/48 runs fail in `beforeAll(setup)` at the 5 s default hook timeout, because `openssl` and `git clone` are slow at load average ~140. This is a different failure from the held assertion and is not touched by the wait. It was not fixed here and no timeout was raised.
- Single run on the branch: `bun test jobs/cli.reviewer-hold.test.ts` passes (2 pass, 0 fail, 28 s).

## 200 runs per tree (aleph-811)

This section is a larger sample of the same loop, with the `--timeout=30000` flag that `bun run test` uses. The 48-run section above had no flag. The flag removes the 5 s `beforeAll(setup)` timeouts, which stopped 17 of the 96 runs before the tests ran. The fix for that hook timeout is aleph-810, and the flag does not replace it. The 48-run section is kept as it was.

### Loop

```
seq 1 200 | xargs -P 24 -I{} bash -c 'bun test --timeout=30000 jobs/cli.reviewer-hold.test.ts > logs/<tree>/run{}.log 2>&1; echo $? > logs/<tree>/run{}.rc'
```

200 runs per tree, 24 at a time, each tree run as two batches (runs 1-96, then 97-200). Before = scratch copy of 5270fe3^ with `node_modules` symlinked. After = this branch. The logs and exit codes were kept outside the repo; the loop is not committed.

Load average (1 / 5 / 15 min) at the start of each loop, from `uptime`:

| Loop | Started | Load at start |
|---|---|---|
| before, runs 1-96 | 20:11:46 | 87.07 / 89.41 / 106.38 |
| before, runs 97-200 | 20:15:01 | 141.74 / 121.85 / 116.33 |
| after, runs 1-96 | 20:17:59 | 118.06 / 118.94 / 116.02 |
| after, runs 97-200 | 20:20:04 | 104.05 / 113.34 / 114.35 |

### Result

| Tree | Passed | Failed |
|---|---|---|
| before (5270fe3^) | 200/200 | 0 |
| after (this branch) | 192/200 | 8 |

Failures by kind:

| Failure | before | after |
|---|---|---|
| held assertion, `Held: fheldland is failed` (in the test "a stuck or failed run holds the factory only once no next run is pending for it") | 0/200 | 0/200 |
| first test `a stuck job holds the factory` timed out at 30 s | 0/200 | 0/200 |
| setup hook (`beforeAll(setup)`) timed out | 0/200 | 0/200 |
| other | 0/200 | 8/200 |

The 8 other failures are all the same assertion, `expect(unitAlive(live)).toBe(true)` at line 88 of the branch's test file (col 29). It fails with `Received: false`, right after the test starts `sh -c "sleep 60; :"`. The held assertion (line 83 of the branch's file, labelled `line 78` in its diagnostic text) passed in all 200 after runs. The before tree's file has no line-88 check, so its "other" count is not a like-for-like comparison.

95% upper bounds of the flake rate (exact Clopper-Pearson, two-sided):

| Tree | Held assertion | Any failure |
|---|---|---|
| before | 0/200, upper 1.8% | 0/200, upper 1.8% |
| after | 0/200, upper 1.8% | 8/200 (4.0%), upper 7.7% |

### Reading

- The baseline did not reproduce the held-assertion flake in 200 runs (0/200, 95% upper bound 1.8%). The aleph-800 baseline was 1/48 without the flag. Its before tree had 11 setup-hook timeouts, and this loop had none in either tree, so the flag is a likely cause of the difference. This loop therefore does not confirm the 1/48 baseline rate.
- The 200-run data do not show that the aleph-782 wait removes the held-assertion flake: both trees show 0/200, and that count cannot tell a rate near 0 from a rate of about 1.8%. The run does not confirm the wait.
- The after tree has a different failure, `unitAlive(live)` at line 88, in 4.0% of runs. It is not the held assertion and was not fixed here. The branch's test file was not changed.
- The sample is 200 runs per tree, the full sample the time box allowed. No run was cut off.
