---
name: verify-completion
description: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always
---

# Verification Before Completion

## Iron Law

**No completion claims without three structured statements about what you tested, in this turn.**

Run the check. Read the output. Then commit to a verifiable claim.

## How the gate works (mechanical, not optional)

The Stop hook (`src/core/hooks/quality-check-stop.ts`) enforces this. The full
contract lives in `src/eval/verify-policy.ts` and runs on every turn:

| Class | What you edited | What's needed to pass |
|---|---|---|
| **SKIP** | every edited file is docs-only (`*.md`, `*.txt`, anything under `docs/`) | nothing — passes silently |
| **REQUIRED** | anything else (code, config, settings, hooks, JSON that ships) | three structured marker lines in this turn's tool output, **OR** an explicit user grant |

If REQUIRED is unsatisfied the hook returns `decision: block` and the harness
refuses to end the turn. There is no advisory level, no file-count threshold,
no UI-vs-server distinction.

## What satisfies REQUIRED

Run a test (or any command that exercises the change) and emit three lines
that describe what you did and what passing means:

```ts
console.log('[verify-type] bun test src/tests/foo.test.ts');
console.log('[verify-surface] foo() with negative inputs and the API error path');
console.log('[verify-behavior] negative inputs return the documented error shape, not a throw');
```

The hook reads the turn's tool output and looks for **all three**:

1. `[verify-type] <…>` — the literal command or test that ran. The audit log
   later asks "what did you actually run?"; this answers it.
2. `[verify-surface] <…>` — what was exercised. UI button, API endpoint, hook
   stdin, function input. Answers "what did the test poke at?"
3. `[verify-behavior] <…>` — what passing this test proves about the change.
   Not "the test passed" — the *meaning* of the pass. This is the field a
   reviewer reads to judge whether the test was about the right thing.

The markers are literal `console.log` lines — no library, no harness setup.
A convention the hook scans for, nothing more.

## What the gate deliberately does NOT check

The hook does **not** scan tool output for "N pass / M fail" or any other
test-runner shape. Pattern-matching can't tell whether a test actually ran
or actually exercised the change — only whether the text *looks like* a
test summary. The structured markers are the audit trail: you commit to
*what you tested*, *how*, and *what passing proves*.

If you fabricate the markers without running anything, that's lying — and
no regex would catch lying anyway. Code review is the defense against that,
and it always was.

## Specificity is on you

When you write `[verify-behavior]`, write what the test actually covers. If
a button-press flow changed and your test only loads the page, that's lying
— both to the hook and to the user reading the description. The hook can
prove you committed to a claim. It cannot judge whether the claim is true.

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
| "Build passes" | Doesn't satisfy. Build doesn't exercise behavior. Add the three markers naming a real test. |
| "ui:smoke passed all routes" | Add the three markers (or have the test runner emit them). |
| "I curl'd the endpoint and got 200" | For an API change, name the test in `[verify-type]`, the endpoint+inputs in `[verify-surface]`, and the response-shape claim in `[verify-behavior]`. |
| "All existing tests still pass" | Existing tests cover existing behavior; the change needs a new or extended test that you can declare. |
| "I checked it manually in the browser" | Encode the check as a test, then declare it. |

## Why this is non-negotiable

Claiming work complete without a verification claim is dishonesty disguised
as efficiency. Trust is broken when claims and evidence diverge. The hook
removes the opportunity to drift — either you committed to what you tested
in this turn's transcript, or the gate blocks.

Run the command. Read the output. Then commit to a verifiable claim.
