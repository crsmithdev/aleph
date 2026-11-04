---
name: code-change
description: >
  Code change: the smallest diff that meets the goal, each line traced to it
  and each step proved by a run. Use when you write, edit or delete code for a
  task, including a fix or a refactor.
---

Adapted from karpathy-guidelines (github.com/multica-ai/andrej-karpathy-skills @2c60614, MIT per its frontmatter) and Matt Pocock's `codebase-design` (github.com/mattpocock/skills @4ae2317).

# Code change

Make a **surgical** change: the fewest lines that meet the goal, and every changed line traces to it. The four steps run in order; the rules apply during step 3.

## Steps

1. **Turn the goal into checks.** Before the first edit, plan the steps, each with the run that proves it:

   ```
   1. <step> → verify: <command> shows <result>
   2. <step> → verify: <command> shows <result>
   ```

   "Fix the bug" becomes "a test that fails on the bug, then passes". "Add validation" becomes "tests for the invalid inputs, then make them pass". "Refactor X" becomes "the same tests pass before and after". Done when every step has a `verify:` that a command can show; step 3 runs each one.

2. **Settle each reading.** Where the goal reads two ways and the readings lead to different code, take the reading you would recommend and record it: in the `defaults` field when your brief defines one, else in your summary. Where a simpler approach than the one the goal names meets the goal, take it and say why. Done when each ambiguity you found has a recorded choice.

3. **Make the change** under the rules below. Done when each `verify:` from step 1 shows its result in a run after your last edit.

4. **Trace the diff.** Read `git diff` against the base line by line. Done when each changed line traces to the goal, or you reverted it.

## Rules

### Size

- Write the code the goal asks for and stop there: the goal's features, options and flags, and error handling for the cases that can happen.
- Code with one caller stays inline at that caller. A new function, class or file earns its place when a second caller needs it, or when it hides real complexity behind a small interface.
- When the diff is long, look for the short version and rewrite. The test: would a senior engineer call it overbuilt?

### Scope

- Match the style of the file you edit, even where you would write it another way.
- Leave adjacent code, comments and formatting as they are.
- Remove the imports, variables and functions that your change made unused.
- Record pre-existing dead code, a bug or a slow path that you find as a follow-up (in the `followups` field when your brief defines it), and leave that code as it is.

### Interfaces

These rules apply only when the goal adds a module or changes a module's interface: its signature, invariants, error modes or configuration. Otherwise the Scope rules win, and you restructure nothing.

- Read [`codebase-design`](../codebase-design/SKILL.md) and use its words: module, interface, depth, seam, adapter.
- **Deletion test**: picture the module deleted. If its complexity reappears across its callers, it earns its keep; if the complexity vanishes, it is a pass-through, so inline it.
- **One adapter is a hypothetical seam; two adapters are a real one.** Add a seam only where something varies across it.
- **The interface is the test surface.** Test through it. A test that must reach past it says the module has the wrong shape.
- Prefer to deepen an existing module over adding a shallow one beside it.
