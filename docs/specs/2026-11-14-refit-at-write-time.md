# Refit at write time

Status: draft 2026-11-14. Source: a review of `writing-for-agents` against upstream and prior art, then of the four refit skills, in one session on 2026-11-14.

## Problem

The four refit skills (`refit-code`, `refit-agents`, `refit-docs`, `refit-tests`) have the same shape: a `check` mode for a plan or diff, a Holds table, and a `retro` that finds problems after they land. They catch problems late:

| Domain | Writer skill | Where the rules live | While writing | At commit or test |
|---|---|---|---|---|
| code | code-change, tdd | refit-code lenses only | Stop hook `skills/refit-code/hook.ts` | none |
| agents | writing-for-agents | split: theory in the writer, evidence checks in `skills/refit-agents/ADHERENCE.md` | none | agnix in `.githooks/pre-commit`, `load.test.ts` |
| docs | docs-writing | the writer owns prefixed rules, and refit-docs lenses cite them | none | `refs.test.ts`, `aleph doc-claims` |
| tests | tdd | refit-tests lenses only | none | `tests/clock-lint.test.ts` |

- Nothing calls `check`. No file in `jobs/`, `lib/`, `identity/`, code-change or tdd names a refit skill. `check` fires only when the model picks the skill from its description, and factory agents load no skills.
- Only code has a tool check inside the session.
- 24 of 45 holds are "unchecked": only a retro finds them. Per skill, tool/model/unchecked: code 4/3/7, agents 3/2/6, docs 2/1/4, tests 1/1/7.
- Rule ownership differs by domain. In code and tests the writer never sees the rules.

## Decisions

1. **Each check runs in the tier where its problem is cheapest to catch.** The tier depends on when the problem gets expensive and on who can detect it. Rules held in the writer's context cost tokens on every turn, and a model follows only part of a long list (IFScale, arXiv 2507.11538: 68-85% at 250 instructions). A tool costs nothing until it fires. A reviewer with fresh context and one question at a time finds more than a writer who holds forty rules and the task.

   | Tier | What it catches | Mechanism |
   |---|---|---|
   | Before writing | One-way decisions: a new skill or a line, a new module or an edit, where a rule lives, a name, a split | The writer skill runs `refit-<domain> check` on its plan |
   | While writing | Anything a tool can detect | One Stop hook runs the tool holds of each domain the session changed |
   | After the draft | Judgment: no-ops, contradictions, completion criteria, trigger overlap, hollow tests | A fresh subagent asks each lens's Check question of the diff |

2. **The writer owns the generative rules, and the auditor cites them and owns detection.** This is the docs arrangement today. A generative rule shapes a draft: pointers, the information ladder, leading words, a positive target. A detection rule names a signal, its proof and its fix. A writer skill carries no checklist.

3. **Each writer skill calls `check` in one line.** code-change and tdd call refit-code and refit-tests, docs-writing calls refit-docs, and writing-for-agents calls refit-agents. A factory role gets the same line in its prompt text, as it gets its one skill today.

4. **One Stop hook serves all four domains.** It generalizes `skills/refit-code/hook.ts`: it sorts the session's changed files by domain, runs that domain's tool holds, and blocks once per finding set with the evidence. It keeps the existing rules: it counts only changes since the session started, and it never blocks a stop that a Stop hook already continued. It runs in any repo. A tool that is not installed is skipped and named in the block text. It records each block and its domain, because PRINCIPLES.md rule 4 keeps a gate only while its record shows catches.

5. **The judgment pass runs after the draft, in a fresh context.** In solo work it runs at the end of a task that changed files of a domain. In the factory the reviewer runs it, with the Check questions of the domains in the diff.

6. **Unchecked holds move to tool holds where the table already names the tool.** This follows the existing rule that a finding that comes back moves up a kind.

## Milestone 1

- The shared Stop hook, with the tool holds that exist today: refit-code's three checks, agnix on changed agent files, `refs.ts` broken links and orphans on changed docs, and the clock lint on changed test files.
- The `check` line in code-change, tdd, docs-writing and writing-for-agents.

## Open questions

- PRINCIPLES.md rule 4 asks for evidence before a new gate. The hook in milestone 1 runs holds that exist today, and only moves them earlier. The `check` line and the judgment pass have no evidence yet.
- Is a slim writer plus a later check better than a writer that carries the checklist? Nobody measured it. The refit skills are new, so traces hold little data. An A/B like the grill-me one would answer it: write the same 3 skills both ways, then count refit-agents findings and tokens.
- Should writing-for-agents fork from upstream and take a new name (proposed: `agent-docs-writing`)? This ends the vendored-upstream decision for that skill. Upstream has no change since our `4ae2317` base.
- Should the hook block on `content.ts` hits, or only report them? They are candidates, and some are false.
- What is the time budget? refit-code's hook has a 20 s timeout, and agnix plus `refs.ts` add to it.
- How much does the factory reviewer prompt grow when it carries the Check questions of up to four domains?
