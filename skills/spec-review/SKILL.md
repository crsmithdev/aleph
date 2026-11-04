---
name: spec-review
description: >
  Spec review: find where a builder with no one to ask would have to guess,
  where clauses conflict, and where no check can observe a clause, each with a
  proposed rewrite. Use when you check a spec, plan or Oracle before a builder
  starts on it.
---

Adapted from the analyze and clarify commands of github/spec-kit (@a227e383, MIT), the builder check of obra/superpowers (@22f0b463, MIT), the requirements review gate of gotalab/cc-sdd (@e2a0c671, MIT), the verification-gap review of bmad-code-org/BMAD-METHOD (@022be931, MIT per its LICENSE file) and the spec-to-code-compliance checker of trailofbits/skills (@711af095, CC-BY-SA-4.0, ideas only).

# Spec review

Read the spec as the **builder** who will build it alone: nobody answers questions, so each place where the builder must guess, and a wrong guess changes the result, is a problem. A choice the spec leaves to the builder on purpose, and a choice any good builder would make the same way, is not.

## Steps

1. **Split the spec into clauses.** One clause is one requirement: each sentence of the Goal and each Oracle item. Done when every clause has a number.
2. **Check each clause against the code.** For each file, function, command or behaviour the clause names, open it. Done when each named thing is either found, with `file:line`, or recorded as absent with the searches you ran.
3. **Run the passes below** over every clause. Done when every clause has passed each pass or has a problem.
4. **Filter the problems.** Keep a problem only when a wrong guess on it would change what the builder builds or what the check observes. Done when each kept problem names that change.

## Passes

- **Vague.** A word with no measure ("fast", "robust", "clean", "handles errors", "works well"), or a placeholder (`TODO`, `???`, `<...>`).
- **Under-specified.** A verb with no object or outcome ("improve the parser"), or a case the clause implies and does not settle: an empty input, an error path, a second caller.
- **Conflict.** Two clauses that cannot both be true in this codebase, or one clause the current code makes false in a way the spec does not ask to change.
- **One name, one thing.** The same concept under two names, or one name for two concepts.
- **Wrong about the code.** A clause that names a file, function, flag or behaviour that does not exist or does not behave as the clause says.
- **Out of reach.** An Oracle clause whose code lies outside the Edit surface.
- **Not observable.** An Oracle clause that no check can see. A check counts when it runs normally and an assertion observes the changed output, state or error. These do not count: a read of the source text, "does not throw", a snapshot alone, a mock or log call, and a manual look.

## Evidence

- **A name is not evidence.** A function named like the behaviour may not do it: read it before you say the code agrees with a clause.
- **An absence must be earned.** Search for synonyms and callers, not only the spec's words, and record each search with its hit count.
- **Quote the clause exactly.** A paraphrase replaces the clause with your reading of it.

## A problem and its rewrite

Each problem quotes the clause and proposes the replacement text. Write an Oracle rewrite as an observable rule:

```
When <trigger or input>, <the subject> <does the observable thing>.
```

For example, "the import is robust" becomes "When a CSV row has fewer columns than the header, `importRows()` skips the row and adds its line number to `skipped`."

When no problem passes the filter, the spec passes.
