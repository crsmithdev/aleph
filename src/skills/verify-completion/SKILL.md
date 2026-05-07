---
name: verify-completion
description: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always
---

# Verification Before Completion

## Iron Law

**No completion claims without a `[verify]` block in this turn.**

Run the check. Read the output. Then commit to a verifiable claim.

## How the gate works

The Stop hook (`src/core/hooks/quality-check-stop.ts`) enforces this. The
contract lives in `src/eval/verify-policy.ts`:

| Class | What you edited | What's needed to pass |
|---|---|---|
| **SKIP** | every edited file is docs-only (`*.md`, `*.txt`, anything under `docs/`) | nothing — passes silently |
| **REQUIRED** | anything else (code, config, settings, hooks, JSON that ships) | a `[verify]` block with three required keys, **OR** an explicit user grant |

If REQUIRED is unsatisfied the hook returns `decision: block` and the harness
refuses to end the turn.

## What satisfies REQUIRED

Run a test (or any command that exercises the change) and emit a `[verify]`
block in the turn's tool output:

```
[verify]
scope:      src/foo.ts:1-20, src/tests/foo.test.ts
method:     bun test src/tests/foo.test.ts
assertions: negative inputs return the documented error shape; exit code 0
[/verify]
```

Three required keys, all non-empty:

1. **scope** — files/lines exercised. Answers "what did the test touch?"
2. **method** — what you ran. Command, inputs, procedure.
3. **assertions** — what you checked. The meaning of the pass, not just "it passed."

`failure-mode` and `gaps` are recognised optional keys: include them when
they're load-bearing (you want to flag a known limitation, or the test is
subtle enough that the failure mode isn't obvious). They're captured to
telemetry when present, but no longer required.

## What the gate deliberately does NOT check

The hook is shape-only — present + non-empty per required field. It doesn't
judge whether your assertions are sharp, your scope is honest, or your
method actually exercises the change. That's a code-review responsibility.

If you fabricate the block without running anything, that's lying — and
no regex would catch lying. Code review is the defense.

## The skip path — only the user can authorise

If verification is genuinely inappropriate (a paid endpoint, a non-code
change misclassified as REQUIRED), ask in chat:

> "I'd like to skip verification because <reason>. OK?"

If the user replies with `skip verify` (or `skip verification`), the hook
accepts it once. Claude cannot author this phrase on its own behalf.

## Common failure modes that this gate catches

| Claim | What you'd need to satisfy the gate |
|---|---|
| "Build passes" | Doesn't satisfy. Build doesn't exercise behavior. Emit a `[verify]` block naming a real test. |
| "ui:smoke passed all routes" | Emit the block: scope=routes covered, method=ui:smoke command, assertions=what each route asserted. |
| "I curl'd the endpoint and got 200" | For an API change, scope=endpoint+test file, method=the curl or test, assertions=response-shape claim. |
| "All existing tests still pass" | Existing tests cover existing behavior; the change needs a new or extended test you can name. |
| "I checked it manually in the browser" | Encode the check as a test, then emit the block. |

## Why this is non-negotiable

Claiming work complete without verification is dishonesty disguised as
efficiency. Either you committed to what you tested in this turn, or the
gate blocks.

Run the command. Read the output. Then commit to a verifiable claim.
