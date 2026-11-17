---
name: write-code
description: >
  Code change: the smallest diff that meets the goal, each line traced to it
  and each step proved by a run. Use when you write, edit or delete code for a
  task, including a fix or a refactor.
---

Adapted from karpathy-guidelines (github.com/multica-ai/andrej-karpathy-skills @2c60614, MIT per its frontmatter) and Matt Pocock's `codebase-design` (github.com/mattpocock/skills @4ae2317).

# Code change

Make a **surgical** change: the fewest lines that meet the goal, and every changed line traces to it. The five steps run in order; the rules apply during step 3.

## Steps

1. **Turn the goal into checks.** Before the first edit, plan the steps, each with the run that proves it:

   ```
   1. <step> → verify: <command> shows <result>
   2. <step> → verify: <command> shows <result>
   ```

   "Fix the bug" becomes "a test that fails on the bug, then passes". "Add validation" becomes "tests for the invalid inputs, then make them pass". "Refactor X" becomes "the same tests pass before and after". When the goal is a bug or a flaky test, call the Read tool on [diagnosing-bugs](../diagnosing-bugs/SKILL.md) before you plan, and make its feedback loop your first step. Done when every step has a `verify:` that a command can show; step 3 runs each one, and for a bug, when you have read diagnosing-bugs.

2. **Settle each reading.** Where the goal reads two ways and the readings lead to different code, take the reading you would recommend and record it: in the `defaults` field when your brief defines one, else in your summary. Where a simpler approach than the one the goal names meets the goal, take it and say why. Done when each ambiguity you found has a recorded choice.

3. **Make the change** under the rules below. Done when each `verify:` from step 1 shows its result in a run after your last edit.

4. **Trace the diff.** Read `git diff` against the base line by line. Done when each changed line traces to the goal, or you reverted it.

5. **Check the diff.** Read the `## Check` section of [refit-code](../refit-code/SKILL.md) and run its steps on the diff. When the diff adds or changes a test, do the same with [refit-tests](../refit-tests/SKILL.md). When it changes an event, a record field, a migration or a number a page shows, do the same with [refit-data](../refit-data/SKILL.md). Done when your summary lists each item with its verdict, and each verdict other than keep is applied.

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

### Style

Code is minimal and good to look at. A repo's own style guide, glossary or principles win over these rules. When the repo runs a formatter, the formatter has the last word on whitespace.

1. **Short names.** A name grows with its scope: `lo`, `hi` in a loop, `runs`, `edges` in a function, `NAME_MAX` in a module. Not `wordIndex` or `separatorValues`.
2. **The glossary's words.** A thing the repo's glossary names keeps that name, whole, at every scope. Do not shorten it or invent a second word for it.
3. **No noise in a name.** No type (`payloadArr`), no `data`, `info`, `value`, `num` or `List`. A plural is a collection: `runs`, `states`.
4. **Two characters or more.** A one-letter name lives only in a loop, a callback or a one-line lambda.
5. **A legend for abbreviations.** When a module uses short forms in many places, its top comment lists them once, as aleph's `lib/naming.ts:4` does. A glossary term is never abbreviated.
6. **Whole collections, not loops.** A `map`, `filter` or query shows the shape of the operation. A loop is for a step that depends on the step before it.
7. **Short functions.** A function does one job in a few lines. Its doc comment is one line that says what it returns.
8. **Flat.** Return early. No `else` after `return`. No more than two levels of indent inside a function.
9. **Parallel things look parallel.** Code that does the same job for different cases has the same shape, line for line, with related lines in the same order.
10. **No defence the inputs do not need.** Check input once, at the boundary. No `??`, `try` or check for a case the types or callers rule out.
11. **Tables stay tables.** A table of data can keep its column alignment behind `// prettier-ignore`. Do this only for data, never for logic.
12. **A comment gives what the code cannot:** a field meaning, a reason, a source. It never says what the next line does. Good: `// The dash is the old shown form: a copied \`j-06802\` still reads.` (aleph, `lib/naming.ts:77`).
13. **Give the shape or the unit** of a value where the code makes it: `const NAME_MAX = 255; // bytes one file name may take` (aleph, `jobs/lib/learning/episode.ts:86`).

### Tests

- Before you write a test, name the code change that would make it fail. If you cannot name one, the test checks nothing.
- Run a new test before the fix, and see it fail for the reason you expect: not a typo, an import error or a missing fixture.
- A run in which no test ran proves nothing. Check the count in the output.
- Assert on what the code returns or leaves behind, not on which calls it made. Prefer the real code, then a fake, then a stub, then a mock.
- For test-first work, follow [write-tests](../write-tests/SKILL.md). For a bug whose cause you do not know, follow [diagnosing-bugs](../diagnosing-bugs/SKILL.md) before you change code.

### Interfaces

These rules apply only when the goal adds a module or changes a module's interface: its signature, invariants, error modes or configuration. Otherwise the Scope rules win, and you restructure nothing.

- Use the words of [codebase-design](../codebase-design/SKILL.md): module, interface, depth, seam, adapter.
- **Deletion test**: picture the module deleted. If its complexity reappears across its callers, it earns its keep; if the complexity vanishes, it is a pass-through, so inline it.
- **One adapter is a hypothetical seam; two adapters are a real one.** Add a seam only where something varies across it.
- **The interface is the test surface.** Test through it. A test that must reach past it says the module has the wrong shape.
- Prefer to deepen an existing module over adding a shallow one beside it.
