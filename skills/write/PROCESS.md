# Writer process

The steps of the six writer skills: write-code, write-tests, write-docs, write-agents, write-data and write-design. A writer
supplies its `RULES.md` and its own steps. Its SKILL.md says only what differs from this file.

Each domain has one writer and one auditor (`docs/specs/2026-11-14-refit-at-write-time.md`). The writer owns how to
write: its `RULES.md`. The auditor, `refit-<domain>`, owns how to find a break in the code that is there.

## Steps

1. **Turn the goal into checks.** Before the first edit, plan the steps, each with the run that proves it:

   ```
   1. <step> → verify: <command> shows <result>
   2. <step> → verify: <command> shows <result>
   ```

   "Fix the bug" becomes "a test that fails on the bug, then passes". "Add validation" becomes "tests for the
   invalid inputs, then make them pass". "Refactor X" becomes "the same tests pass before and after". When the
   goal is a bug or a flaky test, call the Read tool on [diagnosing-bugs](../diagnosing-bugs/SKILL.md) before you
   plan, and make its feedback loop your first step. Done when every step has a `verify:` that a command can show.
2. **Settle each reading.** Where the goal reads two ways and the readings lead to different work, take the reading
   you would recommend and record it: in the `defaults` field when your brief defines one, else in your summary.
   Where a simpler approach than the one the goal names meets the goal, take it and say why. Done when each
   ambiguity you found has a recorded choice.
3. **Write** under the writer's own steps and its `RULES.md`. Done when each `verify:` from step 1 shows its result
   in a run after your last edit.
4. **Trace the diff.** Read `git diff` against the base line by line. Done when each changed line traces to the
   goal, or you reverted it.
5. **Check the diff.** Follow Check below. Done when your summary lists each new item with its verdict, and each
   verdict other than keep is applied.

## Check

1. **List the new things** in the diff, plan or spec: each new function, module, type, constant, literal, route,
   CLI flag, record field, dependency, guard, option, comment, test, doc page or section, agent file line, view and
   style rule.
2. **Read the rules.** For each domain the diff touches, call the Read tool on its file in the table, and ask each
   rule of each item. Record each search a rule names, with its hit count.

   | The diff changes | Read |
   |---|---|
   | code | [write-code/RULES.md](../write-code/RULES.md), its New things |
   | a view, a style rule or UI text | [write-design/RULES.md](../write-design/RULES.md) |
   | a test | [write-tests/RULES.md](../write-tests/RULES.md) |
   | a doc | [write-docs/RULES.md](../write-docs/RULES.md) |
   | an agent file | [write-agents/RULES.md](../write-agents/RULES.md) |
   | an event, a record field, a store migration or a number a page shows | [write-data/RULES.md](../write-data/RULES.md) |

3. **Judge.** Each item gets one verdict: **keep**, **reuse** (name the path), **extend** (name the path), **cut**
   (no case reaches it), **fix** (name the rule), or **second way** (on purpose: add it to `.refit.json`
   `accepted` with the reason).
4. **Apply** each verdict other than keep inside the diff, then run the checks of step 1 again. When a fix reaches
   past the diff, or hits a trigger of [refit/PROVE.md](../refit/PROVE.md) step 2, ask the user, or record it in the
   `defaults` field when your brief defines one. A problem that was there before the diff is a follow-up.
5. **Guards.** When the change makes one copy the owner of a concept, or one module the owner of a seam, add its
   guard in the same diff.
