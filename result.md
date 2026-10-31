# aleph-710: git spawn errors name cwd and PATH

## Scratch check (bun 1.4.2)
- `Bun.spawnSync(["git","--version"], { cwd: "/nonexistent" })` throws `ENOENT: no such file or directory, posix_spawn 'git'`.
- `Bun.spawnSync(["git","--version"], { env: { PATH: "/nonexistent" } })` throws `Executable not found in $PATH: "git"`.

So the text `posix_spawn 'git'` comes from a missing cwd, not from a bad PATH.

## Reproduction
`bun test jobs/lib/plan.test.ts` was run 40 times, one after another, after the edit. All 40 runs passed. No failing run was seen, so this run has no enriched message, stack or failing git call to record, and no cause is guessed here.

The earlier run (commit 865c0eb9e, no longer in this repo) saw ENOENT in runs 23 and 27 of 40. It put the cause down to afterEach removing the store directory while a test that had timed out at 5000 ms was still running. That is consistent with the missing-cwd result above, but this run did not reproduce it.

## Change
`spawnGit` in `jobs/lib/git.ts` wraps `gitWith`, `readFiles` and `itemTimes`. A thrown spawn error is rethrown with the original as `cause`. The one-line message names the cwd, `existsSync(cwd)`, `process.cwd()`, the PATH passed, `Bun.which("git", { PATH })`, TMPDIR and `existsSync(tmpdir())`.
