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
