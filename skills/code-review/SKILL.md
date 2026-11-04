---
name: code-review
description: >
  Code review: judge a finished branch against its goal, with findings
  that are real, introduced by the branch and proved by evidence. Use when you
  review a worker's branch or diff before it lands.
---

Adapted from the review rubric of openai/codex (@f2b94ef8, Apache-2.0), the gate-integrity catalog and review checklist of garrytan/gstack (@46c9f612, MIT), the task reviewer of obra/superpowers (@22f0b463, MIT) and the spec-to-code-compliance checker of trailofbits/skills (@711af095, CC-BY-SA-4.0, ideas only).

# Code review

A review is **sceptical**: the worker's summary, commit messages and its own tests are claims, and the code and your runs are the evidence. A rationale the worker wrote ("kept it simple on purpose") never lowers a finding.

## Steps

1. **Read the goal.** List each requirement of the goal and each Oracle clause. Done when you have the list.
2. **Read the diff.** Read the whole diff once. Read code outside it only to test a risk you can name, and name the risk. Done when you have read every hunk.
3. **Judge each requirement** against the code. Give each one a verdict:
   - **met**: you read the code that does it, on every path.
   - **partial**: it holds on some paths. Name the path where it fails.
   - **missing**: you searched and it is not there. Give the searches and their hits.
   - **wrong**: the branch does something the requirement does not allow.
   - **extra**: the branch adds behaviour that no requirement asks for.

   Done when every item from step 1 has a verdict with `file:line` or a search record.
4. **Read the test changes** against the catalog below. Done when each changed test file is accounted for.
5. **Filter the findings** through the bar below. Done when each finding that is left passes all of it.

## Evidence

- **A name is not evidence.** `validateQty()` may validate nothing. Open the function and the functions it calls before you call a requirement met.
- **An absence must be earned.** The code rarely uses the spec's words: search for synonyms, callers and wrappers, and record each search with its hit count.
- **A hedge resolves.** "Probably", "seems" and "should" become a cited fact, or a line that says what you could not establish.
- **A run beats a reading.** When a doubt can be settled by a short command, run it. A command that exits 0 proves nothing by itself: check that it ran the tests you mean (`0 pass` is not green).

## Test-cheating catalog

Each item is a finding unless the goal asks for the change:

- A test removed, skipped (`.skip`, `xit`) or focused (`.only`).
- An assertion removed or loosened: `toBe` to `toBeTruthy`, an exact value to `toBeGreaterThan(0)`, a larger timeout, tolerance or retry count.
- A tautological test: it asserts its own setup, mirrors the implementation, or has no input it rejects.
- A test that checks a mock, a log call, the source text or only "does not throw" where the goal needs a behaviour.
- A snapshot or golden file regenerated with no change to the test that owns it.
- A suppression added in product code: `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, an empty `catch {}`.
- Product code that branches on the test environment (`NODE_ENV === "test"`, `process.env.CI`).
- A placeholder in product code: `throw new Error("not implemented")`, `TODO` in place of the behaviour.
- The spec or an Oracle clause edited so that the branch meets it.

## The bar for a finding

A finding goes in the review only when all of these hold:

- The branch introduced it. A pre-existing defect is not this branch's finding.
- It is one discrete defect with a concrete fix.
- It changes correctness, security, the goal's requirements, or a test's power to fail. Style, naming and wording pass unless they hide meaning or break a rule the repo states.
- A claim that the branch breaks other code names that code and shows how.
- The worker would fix it if told.

A review with no findings is a valid review: when nothing passes the bar, the branch passes.
