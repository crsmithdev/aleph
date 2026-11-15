# Refit at write time

Status: approved 2026-11-14. Source: a review of `write-agents` (then `writing-for-agents`) against upstream and prior art, a review of the four refit skills, and a red team of the first draft (08af93cb), in one session on 2026-11-14.

## Decision

Each domain has one writer skill and one auditor skill, with matching names. The writer's last step runs the auditor's `check` on what it wrote. The writer owns how to write, and the auditor owns how to detect. No hook is added or changed.

| Domain | Writer | Auditor | The writer's last step |
|---|---|---|---|
| code | `write-code` (was `code-change`) | `refit-code` | refit-code `check` on the diff, plus refit-tests `check` when the diff changes a test |
| tests | `write-tests` (was `tdd`) | `refit-tests` | refit-tests `check` on the tests it wrote |
| docs | `write-docs` (was `docs-writing`) | `refit-docs` | refit-docs `check` on the pages it changed |
| agents | `write-agents` (was `writing-for-agents`) | `refit-agents` | refit-agents `check` on the files it changed |

Each layer:

- **Audit:** `refit-<domain> retro`, by hand.
- **Check while writing:** the writer's last step, a link to the auditor's `## Check`. A factory worker reaches it with no change to its role: `skillSection` makes the link absolute, so the worker can Read it.
- **Hard floor:** agnix in `.githooks/pre-commit`, and `test:all` in `.githooks/pre-push`, which runs `refs.test.ts`, `load.test.ts` and `tests/clock-lint.test.ts`.
- **Code at Stop:** the existing refit-code hook, unchanged.

## Why

- Chris wants audit and enforcement while writing for the least work beyond the skills.
- The tool holds of the agents, docs and tests domains already run at commit or push, and they fail closed for solo and factory runs.
- No catch record shows that an earlier tier would have stopped a defect. PRINCIPLES.md rule 4 asks for that record before a new gate.
- The `write-<domain>` names pair each writer with its `refit-<domain>` auditor. The write-tests description keeps "TDD, test-first" as its first words, so the trigger stays.

## Limits

- The `check` step is a prose rule. A model follows it most of the time, not every time. The commit and push gates catch what the model skips.
- `check` runs in the writer's own context, so it shares the writer's blind spots.
- A factory worker sees write-code only in a repo with `sandbox` set (`jobs/lib/transitions/continuation.ts`).
- Use is measured offline: the transcripts show a Read of a refit skill or a Skill call.
- Headless check, 2026-11-14 (`claude -p`, Sonnet, `--disable-slash-commands`, a 6-line task, the write-code section as the brief):
  - With a link to `SKILL.md#check`, 0 of 1 runs read refit-code.
  - With "read the `## Check` section" and a summary that lists the verdicts, 3 of 3 runs read refit-code and refit-tests.
  - 2 of those 3 runs listed a verdict for each item. The third run said it "did not run them in full".

## Rejected

The first draft proposed three tiers: a `check` line, one Stop hook shared by four domains, and a judgment pass after each task. The red team returned REVISE for these reasons:

- No catch record supports the premise.
- Pre-commit and pre-push already run the holds that the shared hook would move.
- Scoped runs do not work. `refs.ts` reads the whole repo, and the clock lint is a bun test bound to aleph's layout.
- The judgment pass has no trigger in solo work.
- Hooks cannot reach a factory worker's skills.
- The draft also counted 45 holds where the tables hold 41 (24 unchecked).

The red team also found defects in the existing `skills/refit-code/hook.ts`, which are now issues:

- It skips a retry after another Stop hook blocks (a-02850).
- A crash passes in silence (a-02851).
- Its blocks have no cap (a-02852).
- A missing session start blames the agent for old files (a-02853).

## Open questions

- Should `check` run in a subagent, for a fresh context, at one extra run per task?
- Does the refit-code hook earn its place? The transcripts hold 25 of its blocks, possibly with duplicates. A study of what each block caused would answer it.
