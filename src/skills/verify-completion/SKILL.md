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
| **REQUIRED** | anything else (code, config, settings, hooks, JSON that ships) | three structured markers AND a passing test summary in this turn's tool output, **OR** an explicit user grant |

If REQUIRED is unsatisfied the hook returns `decision: block` and the harness
refuses to end the turn. There is no advisory level, no file-count threshold,
no UI-vs-server distinction, no "fine to skip if dev server unavailable."

## What satisfies REQUIRED

Run a test (or any command that exercises the change) and emit three lines
that describe what you did and what passing means:

```ts
console.log('[verify-type] bun test src/tests/foo.test.ts');
console.log('[verify-surface] foo() with negative inputs and the API error path');
console.log('[verify-behavior] negative inputs return the documented error shape, not a throw');
```

Then run it. The hook reads the turn's tool output and looks for **all four**
of these:

1. `[verify-type] <…>` — the literal command or test that ran. The audit log
   later asks "what did you actually run?"; this answers it.
2. `[verify-surface] <…>` — what was exercised. UI button, API endpoint, hook
   stdin, function input. Answers "what did the test poke at?"
3. `[verify-behavior] <…>` — what passing this test proves about the change.
   Not "the test passed" — the *meaning* of the pass. This is the field a
   reviewer reads to judge whether the test was about the right thing.
4. A passing summary, in either form:
   - **Numbered:** `3 pass, 0 fail` / `30 passed, 0 failed` / `24 passed, 0 failed (3.4s)` —
     any `\d+ pass(ed)?` with zero failures.
   - **Generic:** `all 24 smoke routes passed` / `all tests pass` / `all checks pass` —
     when your test runner doesn't print a count, an "all <test-noun> pass(ed)"
     phrase counts as full-pass evidence.

The markers are literal `console.log` lines — no library, no harness setup.
A convention the hook scans for, nothing more.

## What does NOT satisfy REQUIRED

- `bun test` of unrelated tests with no verify-* markers.
- `bun run build` (compilation isn't testing).
- `bun run ui:smoke` *alone, with no markers* — even though it's a real test,
  the gate still wants you to declare type/surface/behavior so the audit log
  records intent. Add the three lines via `echo` or in the script's output.
- `curl http://localhost:3001/...` against the route (proves the page
  returned bytes, not that your change produces the expected output).
- Starting the dev server and walking away.
- Saving a screenshot.

## Specificity is on you

The hook can prove you ran *a* test that emits the markers. It can NOT judge
whether the test exercises the actual behavior you changed. That part is on
you, enforced by code review. When you write `[verify-behavior]`, write what
the test actually covers. If a button-press flow changed and your test only
loads the page, that's lying — both to the hook and to the user reading the
description.

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
| "ui:smoke passed all routes" | Add the three markers (or have the test runner print them). |
| "I curl'd the endpoint and got 200" | Doesn't satisfy for a UI change. For an API-only change, run a test that asserts on the response body. |
| "All existing tests still pass" | Doesn't satisfy. Existing tests cover existing behavior; the change needs a new or extended test. |
| "I checked it manually in the browser" | Doesn't satisfy. The hook can't see manual checks. Encode the check as a test. |

## Why this is non-negotiable

Claiming work complete without verification is dishonesty, not efficiency.
Trust is broken when claims and evidence diverge. The hook removes the
opportunity to drift — either you exercised the change and it's recorded in
this turn's transcript, or the gate blocks.

Run the command. Read the output. Then claim the result.
