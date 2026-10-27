# Seed factory proofs

The proof runs for AC 33–35 of `docs/specs/2026-10-26-seed-factory.md`.
Chris's minutes are an estimate: the session does not time his answers.
The cost is at the API price; the runs use the claude.ai subscription.

| Item | Chris's minutes | Runs | Cost | Result |
|---|---|---|---|---|
| aleph 28: 5.5 prices in `hooks/lib/pricing.ts` | about 5 (two question rounds) | 1 | $0.0804 | Passed and landed unattended: `50f301f`, trailers `Item: aleph-28` and `Job:`. New `hooks/lib/pricing.test.ts` asserts the prices from https://claude.com/pricing. |
| aleph 27: digest keeps head and tail of Bash output | about 3 (one question round, one land decision) | 1 | $0.0663 | Needs-you on the held path `hooks/lib/digest.ts`. Chris landed it: `c41ec06`, trailer `Held-by: Chris`. A replay of session 527e44d7 now shows `judge.ts:2` and `judge.ts:37`. |

Both runs started on the 09:05 tick on 2026-10-27 and ended in about 4 minutes.
After both lands, `bun test` on `main` gave 213 tests, 0 fail, and `tsc` was clean.
