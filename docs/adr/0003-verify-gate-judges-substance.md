# 3. The verify gate judges substance

- Status: accepted
- Date: 2026-09-03

## Context

A turn that changed code ended with a `[verify]` block. The block was a check of shape only: by its own header, a fabricated block passed. An interview on 2026-09-03 decided what replaces it: a `Stop` hook that judges whether a turn which changed code is honest about what it verified.

## Decision

A fast model judges each turn that changed code. [Hooks](../hooks.md#verify-gate) says what the gate does. This table gives the reason for each decision.

| # | Decision | Reason |
|---|---|---|
| 1 | The gate judges substance, not shape. A fast model reads the final message and a digest of the turn's tool calls. | The old `[verify]` block was shape-only. |
| 2 | The rule: each claim of completion or correctness about code changed this turn must trace to a run of this turn, after the last edit. A plain statement of what was not verified passes on that point. An edit is evidence for a claim about the edit, and a run is evidence for a claim about behaviour. | Without the pass for an honest gap, the model learns never to admit a gap. Without "after the last edit", a run before a later edit counts as proof. |
| 3 | The trigger is a change to a code file, found from a snapshot of the repo and its worktrees at `UserPromptSubmit` and at `Stop`. | An `Edit\|Write` marker misses Bash edits (sed, heredocs), which auto mode encourages. `git status` in the main tree does not show a worktree. A subagent's worktree changes while the turn runs, without any change from the turn itself. |
| 4 | A deny blocks the `Stop` with a reason that names the unbacked claim and what would back it. The gate denies at most twice for each `prompt_id`. Only `skip verify` in the user's message passes a turn unjudged. | A denial with no cap is a stuck turn that spends tokens. A skip that the model can write is no gate. |
| 5 | The judge is a command hook that runs `claude -p --model haiku --setting-sources ""` on the digest. | Measured: 2.5 s wall clock. No settings means no hooks and no plugins in the nested call, so no recursion and no traces of the judge itself. The call bills the subscription. A prompt-type hook cannot see the transcript. |
| 6 | The gate runs on the main agent's `Stop` only. `SubagentStop` stays observability-only. | Subagents report to the main agent, and its `Stop` is gated. |
| 7 | Each verdict is a `guardrail` span under the turn and a `verified` score on the trace. | The verdict rates over weeks show how to tune the rubric. |
| 8 | `identity/CLAUDE.md` states one plain rule, in the words of decision 2. No block, no keys, no printf. | The judge replaces the ritual. |

## Measurements

- **Thinking off.** The Haiku call runs with `--tools ""` and `--effort low`, and its settings leave out the agent effort `high`: that effort keeps Haiku thinking, even with `MAX_THINKING_TOKENS=0`. A verdict takes 3 s without thinking, against 11 to 14 s with it, with the same verdicts.
- **Deny shape.** On Claude Code 2.1.259 the documented `hookSpecificOutput.permissionDecision` shape does nothing for `Stop`. Three shapes were measured in headless sessions, and `{"decision":"block","reason":…}` is the one that blocks.

## Jev screen

Jev screens each turn before Haiku, a later addition measured on 2026-10-27. [Routing](../routing.md#judge) says what Jev is.

**Why one question on the final message.** Jev is close to large judges where the verdict can be read off the text, and weak where it must be derived (Li et al., arXiv 2609.26550: code −12.9 points, logic −27.6). Whether later command output backs a claim is derived, so Haiku keeps that question. Asked the whole rule on the whole digest, Jev reached only AUC 0.64 against Haiku's verdicts.

**Why the Stop input's final message.** At `Stop` the transcript can still lack the last text, and its last text is then a preamble from the middle of the turn. Before the gate read `last_assistant_message`, 71 of 610 stored digests judged such a preamble, and Haiku denied 25 of them.

**What the screen does.** Measured on 517 stored turns: the screen passes 71 of the 392 turns that Haiku passed. It also passes 19 of the 125 turns that Haiku denied. The ones read were preambles with no claim, which Haiku denied in error. A call costs about $0.00002 and 180 ms, against 4 s for Haiku. The findings are in `~/.aleph/research_notes/Jev judge/notes.md`.

## Consequences

- Subagents are not gated. Decision 6 changes if the main agent's gate alone proves too loose.
- No judge calls the API directly. The nested `claude -p` bills the subscription, and with thinking off it takes about 3 s.
- The gate does not detect a change in a repo other than the cwd repo and its worktrees.
