---
name: write-code
description: >
  Code change: the smallest diff that meets the goal, each line traced to it
  and each step proved by a run. Use when you write, edit or delete code for a
  task, including a fix or a refactor.
---

Adapted from karpathy-guidelines (github.com/multica-ai/andrej-karpathy-skills @2c60614, MIT per its frontmatter) and Matt Pocock's `codebase-design` (github.com/mattpocock/skills @4ae2317).

# Code change

Make a **surgical** change: the fewest lines that meet the issue, and every changed line traces to it.

Before the first edit, call the Read tool on [write/PROCESS.md](../write/PROCESS.md) and on [RULES.md](./RULES.md).
Follow the five steps of PROCESS.md in order. The rules of RULES.md apply during step 3, and its step 5 checks the
diff against them.

- For test-first work, follow [write-tests](../write-tests/SKILL.md). For a bug whose cause you do not know, follow
  [diagnosing-bugs](../diagnosing-bugs/SKILL.md) before you change code.
- When the diff adds or changes a test, call the Read tool on [write-tests/RULES.md](../write-tests/RULES.md) before you
  end: its rules apply too.
- When the diff changes a view, a style rule or UI text, call the Read tool on
  [write-design](../write-design/SKILL.md) before the first edit: its steps and rules apply too.
