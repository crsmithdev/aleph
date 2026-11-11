# Adherence lens

Will the agent follow each line, every time, at the least cost? [writing-for-agents](../writing-for-agents/SKILL.md)
is how to write an agent file; this lens audits one against the evidence. Each check carries its evidence:
**measured** (a study or eval), **vendor** (Anthropic or OpenAI guidance), or **practitioner** (opinion with no
data). A finding states its tag, and a practitioner check alone rates 3 at most.

## Signals

Run `bun <skill dir>/content.ts <repo>` first: it gives the regex candidates (`emphasis`, `scaffold`, `vague`,
`unreasoned`, `dated`), each file's sentence count, and each tool the files name. The other checks need judgment.

| # | Check | Evidence | Found by |
|---|---|---|---|
| 1 | **Contradiction.** Two lines, in one file or across files (global and repo memory, a skill, a rule, the README), that cannot both be obeyed | vendor: Claude "may pick one arbitrarily" (code.claude.com/docs/en/memory); GPT-5 spends reasoning tokens to reconcile them (OpenAI GPT-5 prompting guide) | judgment; agnix `XP-004`, `XP-005` for commands and tools |
| 2 | **Discoverable content.** An overview, a file layout, or a fact the agent finds by reading the repo | measured: overviews did not speed up finding files, and context files added about 20% cost (arXiv 2602.11988); vendor: "Claude reads the repo itself" (Claude Code best practices) | judgment, or the rediscovery test below |
| 3 | **Emphasis inflation.** IMPORTANT, CRITICAL, YOU MUST, capitals, "be THOROUGH" | vendor: "piling on emphasis mostly makes Claude over-apply the rule" (Claude Code best practices); write "Use X when..." (Claude prompting best practices) | `content.ts` emphasis |
| 4 | **Hard rule in prose.** A never or always with no exceptions that a hook, a deny rule or CI could enforce | vendor: prose "works most of the time, not every time", and repeated emphasis is "a sign the line belongs in a hook" (Claude Code best practices) | judgment, from the emphasis and unreasoned hits |
| 5 | **Unverifiable bar.** "properly", "clean", "best practice", "should" with no command, path, number or threshold | vendor: "concrete enough to verify" (memory docs); replace qualitative thresholds with concrete ones (Sonnet 5 prompting guide) | `content.ts` vague, then judgment |
| 6 | **Too many instructions.** A file or a load past about 150 instructions, or a memory file past 200 lines | measured: top models follow about 98% of 100 instructions and 68-85% of 250 (IFScale, arXiv 2507.11538); no cliff from 0 to 50 rules (arXiv 2604.11088) | `content.ts` sentences, `load.ts`, agnix `CC-MEM-014` |
| 7 | **Named tool.** A tool the file names that the repo does not want used | measured: a named tool is used about 1.6 times a task, an unnamed one almost never (arXiv 2602.11988) | `content.ts` tools; the user confirms each |
| 8 | **Old-model scaffolding.** "think hard", "be thorough", "don't be lazy", "keep going until done" | vendor: causes overwork on current models (Claude prompting best practices, anti-laziness) | `content.ts` scaffold |
| 9 | **Rule with no reason.** A never or always line that does not say why | vendor: Claude generalizes from the reason (Claude prompting best practices); no study isolates the effect | `content.ts` unreasoned, then judgment |
| 10 | **Unstated scope.** A rule meant for a class of cases, written for one | vendor: Sonnet 5 "interprets prompts literally" and does not generalize (Sonnet 5 prompting guide) | judgment |
| 11 | **Prohibition with no alternative.** A "don't X" with no "do Y" | vendor: say what to do (Claude prompting best practices); measured, mixed: the coding-agent rules whose removal hurt most were prohibitions (arXiv 2604.11088). A prohibition with an alternative is not a finding | agnix `PE-006`, `CC-MEM-006` |
| 12 | **Two names for one thing** in a file or a skill | vendor (skill best practices) | judgment |
| 13 | **Options with no default.** "use A, B or C" with no default | vendor (skill best practices) | judgment |
| 14 | **Examples.** One example, or examples that all look alike, not set off from the instructions | vendor: 3-5 varied examples, or Claude copies unintended patterns (Claude prompting best practices) | judgment |
| 15 | **A linter's job in prose.** A formatting or style rule a tool can check | vendor: keep lint checks in CI (Codex AGENTS.md guide); practitioner (HumanLayer) | judgment |
| 16 | **Dated text.** "as of", "currently", a date | vendor (skill best practices) | `content.ts` dated |
| 17 | **No completion criterion.** A step the agent cannot tell is done | practitioner ([writing-for-agents](../writing-for-agents/SKILL.md)) | judgment |
| 18 | **No-op.** A line the model obeys by default ("be helpful", "write good code") | vendor | agnix `PE-005`, `CC-MEM-005`, then judgment |

**Policy on agnix.** `PE-003` and `CC-MEM-007` turn "should" into "must", so their fix adds the emphasis that
check 3 removes. Read them as check 5: rewrite the line as a plain imperative with a bar ("Run `bun test`").

**The rediscovery test** for check 2: give a subagent the repo and none of its agent files, and ask it each fact
the file states. Each fact it finds with one command or one file read is a candidate to cut.

## Proof

Quote the line and name the check and its evidence tag. For a contradiction, quote both sides. For check 2, give
the rediscovery result. For check 7, the user says the tool is unwanted. A `content.ts` hit is a candidate only:
"don't" inside a reason, "should" in a quote, or a capital in a spec name is dropped with the reason.

## Fix

Delete a no-op, a discoverable fact or scaffolding whole. Rewrite emphasis as "Use X when Y". Give a vague bar a
command, path or number. Add the reason in a clause. State a rule's scope. Move a hard rule into a hook, a deny
rule or CI, then delete the line. For a contradiction, quote both lines to the user and ask which wins, or whether
each holds under a condition; then delete the loser, or state both conditions.

## Hold

`content.ts` counts as a shrink-only ratchet beside the `load.ts` total; model: `check`.

## Check

For each new line: does it contradict a line in context, can the agent find it by looking, and does it give a bar
the agent can check, in plain case?
