# Flaky tests

Each test here is skipped with `// flaky: tests/flaky.md#<anchor>`. A test comes back when
its cause is fixed and it passes 5 runs in a row alone and one run under the full parallel suite. Then its
section goes.

The sources are the flake trackers aleph-1156 and aleph-920 (notes from 2026-10-28 on), the run records whose
`tests` check failed and then passed on the rerun (`~/.aleph/runs/*/state.json`, `rerun: true`), and the
factory monitor of 2026-11-02 and 2026-11-03. The cause column is the likely cause, not a proven one.

Not skipped, because they are no longer in the tree: `check slots > the wait for a slot does not count against
ALEPH_CHECK_TIMEOUT` and `check slots > with one slot two checks started together run one after the other`
(jobs/cli.slots-check.test.ts, rewritten in 17c5cc435), `review browser step > when Chrome's sandbox cannot start`
(review.test.ts, gone), and the tests that moved to acceptance/.

"Fixed after" names a commit that came after the last flake seen and that names the cause. Such a test is the
first to try to bring back.
