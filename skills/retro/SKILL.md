---
name: retro
description: "Retrospective on a coding session: read its trace and transcript, propose fixes to the agent's environment (identity, skills, hooks, vault, tooling)."
disable-model-invocation: true
---

The user has asked for a **retrospective**. You are suggesting improvements to the coding agent's **environment** to improve future runs.

## Steps

1. Call the Skill tool with `aleph:writing-for-agents` for the writing style guide.

2. Read the primary sources for the session the user specifies; default to the current one. The Langfuse trace at `http://127.0.0.1:3010` (id `sha256(session_id)[:32]`) has every hook event, tool call, verify-gate verdict and price; the transcript is `~/.claude/projects/<cwd-slug>/<session_id>.jsonl`. Read the trace first.

3. Look for candidates for improvement in these categories.

- **Navigation**: how easy was it for the agent to find the right files? Are there hidden dependencies between files? Would a **navigation pointer** make it easier? _Use when_ the session took a long time to find a piece of information.
- **Automated checks**: are there automated checks that could catch errors the agent made? Linting, typing, tests, filesystem linters? _Use when_ the agent made a mistake that could have been caught by an automated check.
- **Identity**: is there a steering instruction in `identity/CLAUDE.md` or `~/.claude/CLAUDE.md` that belongs in a skill, a hook, or the vault instead? _Use when_ the always-loaded files are growing, or an instruction fired where it wasn't wanted.
- **Verify gate**: did the gate deny a turn that was fine, or pass one that wasn't? _Use when_ a `guardrail` span in the trace has a surprising verdict.
- **Memory**: did the agent re-derive something the vault already held, or learn something it never wrote down? _Use when_ a fact was looked up twice or lost between sessions.
- **Tool economy**: did the agent make expensive tool calls that could be streamlined? Is there any custom tooling (CLI's, MCP's) that is particularly token-inefficient? _Use when_ the agent made an expensive tool call.
- **No-ops**: look for instructions in steering files that don't modify the agent's behavior. _Use when_ the steering files are large and unwieldy.
- **Information access**: look for opportunities to increase the agent's access to information. Teeing dev server logs, readonly access to third-party services. _Use when_ a crucial piece of information was not available to the agent.

4. Present these candidates to the user, in order of severity, each with the evidence from the trace and the proposed change. Don't apply anything until asked.

## Where a fix lives

- `identity/CLAUDE.md`, `~/.claude/CLAUDE.md`: loaded every session. Only what would cause mistakes if missing; navigation pointers over content.
- Skills: sometimes-relevant workflows and reference. The description is the always-loaded part; write it as the trigger.
- Hooks: anything that must happen every time with no exceptions.
- The vault (`/aleph:vault`): facts about how things actually behave, decisions, corrections.
