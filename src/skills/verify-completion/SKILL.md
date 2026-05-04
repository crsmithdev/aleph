---
name: verify-completion
description: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always
---

# Verification Before Completion

## Iron Law

**No completion claims without fresh verification evidence in this turn.**

Run the check. Read the output. Then claim the result.

## How the gate works (mechanical, not optional)

The Stop hook (`src/core/hooks/quality-check-stop.ts`) enforces this. The full
contract lives in `src/eval/verify-policy.ts` and runs on every turn:

| Class | What you edited | What's needed to pass |
|---|---|---|
| **SKIP** | every edited file is docs-only (`*.md`, `*.txt`, anything under `docs/`) | nothing — passes silently |
| **REQUIRED** | anything else (code, config, settings, hooks, JSON that ships) | a `[verify-what]` marker AND a passing test summary in this turn's tool output, **OR** an explicit user grant |

If REQUIRED is unsatisfied the hook returns `decision: block` and the harness
refuses to end the turn. There is no advisory level, no file-count threshold,
no UI-vs-server distinction, no "fine to skip if dev server unavailable."

## What satisfies REQUIRED

Run a test that exercises the change you made. The test prints a one-line
intent declaration before its first assertion:

```ts
test('research graph canvas has size on first paint after Graph tab click', async () => {
  console.log('[verify-what] research graph canvas non-zero size on first paint');
  await page.goto('/research/sure-falls-trail');
  await page.click('button:has-text("Graph")');
  const box = await page.locator('canvas').first().boundingBox();
  expect(box?.width).toBeGreaterThan(200);
  expect(box?.height).toBeGreaterThan(200);
});
```

Run it (`bun test path/to/that.test.ts`). The hook reads the turn's tool
output and looks for two things, both required:

1. A `[verify-what] <description>` line — your declaration of *what this test
   exercises*. The hook records the description in telemetry; the user reads
   it later and judges whether the test was about the right thing.
2. A passing test summary line — `N pass` with no `M fail` (where `M > 0`).

The marker is a literal `console.log` — there's no library to import, no
harness to set up. It's a convention the hook scans for, nothing more.

## What does NOT satisfy REQUIRED

- `bun test` of unrelated tests with no `[verify-what]` line.
- `bun run build` (compilation isn't testing).
- `bun run ui:smoke` alone (it's smoke; smoke catches "did the bundle boot",
  it never proves your specific change works).
- `curl http://localhost:3001/...` against the route (proves the page
  returned bytes, not that your change produces the expected output).
- Starting the dev server and walking away.
- Saving a screenshot.

The hook does not detect any of these as evidence. Only `[verify-what]` +
passing test summary, or an explicit user grant, will pass.

## Specificity is on you

The hook can prove you ran *a* test that emits the right markers. It can NOT
judge whether the test exercises the actual behavior you changed. That part
is up to you, enforced by code review.

When you write the `[verify-what]` description, write what the test actually
covers. If a button-press flow changed and your test only loads the page,
that's lying — both to the hook and to the user reading the description.

## The skip path — only the user can authorise

If verification is genuinely inappropriate (a paid endpoint that costs money
to call, a non-code change misclassified as REQUIRED, etc.), ask in chat:

> "I'd like to skip verification because <reason>. OK?"

If the user replies with `skip verify` (or `skip verification`), the hook
accepts the skip *once*. Claude cannot author this phrase on its own behalf
— it has to come from a user message.

## Common failure modes that this gate catches

| Claim | What you'd need to satisfy the gate |
|---|---|
| "Build passes" | Doesn't satisfy. Run a test that exercises the change. |
| "ui:smoke passed all routes" | Doesn't satisfy. Run a change-specific test. |
| "I curl'd the endpoint and got 200" | Doesn't satisfy for a UI change. For an API-only change, run a test that asserts on the response body. |
| "All existing tests still pass" | Doesn't satisfy. Existing tests cover existing behavior; the change needs a new or extended test. |
| "I checked it manually in the browser" | Doesn't satisfy. The hook can't see manual checks. Encode the check as a test. |

## Why this is non-negotiable

Claiming work complete without verification is dishonesty, not efficiency.
Trust is broken when claims and evidence diverge. The hook removes the
opportunity to drift — either you exercised the change and it's recorded in
this turn's transcript, or the gate blocks.

Run the command. Read the output. Then claim the result.
