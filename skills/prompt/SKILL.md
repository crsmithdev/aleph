---
name: prompt
description: >
  Rewrite a brief, sloppy prompt into a full one, show it, then run it.
disable-model-invocation: true
---

Adapted from the `prompt-optimizer` skill in github.com/affaan-m/ecc (MIT). The ECC catalog is removed, and the rewrite runs as the task.

The text after `/aleph:prompt` is the **draft**. Rewrite it into a **brief** that a fresh agent could run with no one to ask. Run the brief, then show it in the report.

The brief is an output the user asked for. The user cannot see your thinking: a brief written only there is not shown.

## 1. Read the ground

Read what the draft touches: the conversation so far, the repo's CLAUDE.md, its stack files, and each file, error, command or name the draft mentions.

Done when each noun in the draft maps to a file, a command, a past turn, or a gap.

## 2. Find the gaps

Check the draft for each item:

- **Goal**: the outcome, in one sentence.
- **Deliverable**: code, a plan, or an answer.
- **Scope**: the files, modules or pages to change.
- **Out of scope**: what stays as it is.
- **Acceptance**: the observable state that means done.
- **Verify**: the command or run that shows that state.
- **Patterns**: the existing code or doc to match.

Fill each gap from the repo, the history or a rule, and mark the fill as an **assumption**. A gap is **open** only when its readings lead to materially different work. Put each open gap to the user as one AskUserQuestion question, at most 3, with the recommended option first.

Done when each item is stated by the draft, filled as an assumption, or answered.

## 3. Write the brief

Write these sections, and leave out a section that has nothing in it:

- **Task**: the goal and the deliverable.
- **Context**: the paths and facts from step 1.
- **Steps**: numbered, one bounded action each. If the change crosses 5 or more files, make step 1 a plan.
- **Acceptance** and **Verify**.
- **Out of scope**.
- **Assumptions**: each fill from step 2, one line each.

Where a step fits a skill in this session's skill list, name the skill in the step (`aleph:tdd` for a test-first fix, `aleph:diagnosing-bugs` for a bug).

Keep the brief's scope equal to the draft's. A requirement the draft did not name enters only as a line under Assumptions.

Done when each line traces to the draft, a fact from step 1, or an answer.

## 4. Run the brief

Run the brief as the task, as if the user typed it, under the same rules as any other request.

Done when the brief's Verify step ran.

## 5. Report

Start the final report with the line `Brief:` and the brief in one fenced block, every time, even when the draft looked complete. Then report the run as for any other task, with the Verify output.

Done when the final report starts with `Brief:` and holds the Verify output.
