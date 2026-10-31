# aleph-758: fetch-ttl tests settle before every fetch count

## Changes (ui/fetch-ttl.test.ts)

- Second write test (`with the cache on and warm, ...`): `await settled()` before `start = fetches()`, and `await settled()` replaces `Bun.sleep(300)` after the loop that waits for the fetch line.
- First write test (`a write fetches in the foreground ...`): `await settled()` before `before = fetches()`. The test before it (`the UI fetches the work store at most once per 30 s ...`) ends with a background fetch whose `fetch` line is awaited but whose `done` line is not, so that fetch can still be open.
- No fetch count assertion changed. No timeout raised. `Bun.sleep(300)` is gone.

## Run 1 of aleph-743 vs f5276c4

Not determined. The sandbox has only this repo, and nothing in it names aleph-743 or that run's base commit. f5276c4 (aleph-705) is an ancestor of HEAD. So I cannot say whether run 1 started before or after it, and I have not assumed the first write test still fails. Its `settled()` before the first fetch count is already on this branch (line 97 before the change, and the new line before `before`).

## Verification

- `bun test ui/fetch-ttl.test.ts`: 7 pass, 0 fail.
- `bun run test` (`bun test --timeout=30000 --parallel=$(nproc)`), five runs in the foreground, one after another. Logs in `/tmp/aleph-758-logs/run{1..5}.log`, outside the repo.
  - Run 1: 1152 pass, 0 fail, exit 0
  - Run 2: 1152 pass, 0 fail, exit 0
  - Run 3: 1152 pass, 0 fail, exit 0
  - Run 4: 1152 pass, 0 fail, exit 0
  - Run 5: 1152 pass, 0 fail, exit 0
- `ui/fetch-ttl.test.ts` passed in 5 of 5 runs. No test in that file failed.

## Limits

- The failure reported in aleph-743 run 1 did not reproduce in this sandbox. The five runs show no failure, but they do not show that the load-sensitive failure is gone under the original load of that job. The stated oracle is met, but that is not a reproduction.
