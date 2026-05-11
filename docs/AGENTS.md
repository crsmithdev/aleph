# Agents

Agents are purpose-built autonomous subagents defined in `src/agents/`. They differ from skills:

- **Skills** are playbooks — structured prompt injections that guide Claude's behavior in the current conversation.
- **Agents** are isolated subagents — they run in a separate context with their own tool access, model selection, and instructions. They can read, write, search, and execute independently.

Agents are dispatched via the Agent tool with `subagent_type` set to the agent name. The routing hook (`routing-submit-classify`) can also dispatch agents automatically based on prompt classification.

## Available agents

| Agent | File | Purpose | When to use |
|---|---|---|---|
| code-debugger | `src/agents/code-debugger.md` | Systematic debugging with root-cause analysis | Bugs, test failures, or unexpected behavior — especially when multiple fixes have already failed or the issue spans components. Investigates before proposing fixes. |
| code-reviewer | `src/agents/code-reviewer.md` | Code review with structured findings and fixes | After implementing features, cleaning up technical debt, or reorganizing file structures. Reviews first, presents prioritized findings, waits for approval, then executes fixes. |
| design-reviewer | `src/agents/design-reviewer.md` | Full design review across 15 dimensions | When reviewing UI quality, auditing design, or polishing an interface. Phased output: Critical, Refinement, Polish — with approval gates between phases. |
| docs-optimizer | `src/agents/docs-optimizer.md` | Optimize docs for AI coding assistants | When improving documentation for Claude, Copilot, or other AI tools — c7score optimization, llms.txt generation, question-driven restructuring. |
| docs-reviewer | `src/agents/docs-reviewer.md` | Write, update, and verify documentation | For README files, API docs, guides, or any doc that may have drifted from reality. Phase 1 writes or updates; Phase 2 reviews accuracy and optimizes for AI assistants. |
| skill-creator | `src/agents/skill-creator.md` | Create and improve Construct skills | When creating a skill from scratch, editing an existing skill, running evals, benchmarking performance, or optimizing a skill's description for better trigger accuracy. |

## Selection

Use the most specific agent for the task. Prefer agents over skills for work that benefits from isolation — separate context means no token pollution from the parent conversation, and the agent can use all tools freely.

When multiple agents could apply, pick by primary concern: debugging → code-debugger, review → code-reviewer or design-reviewer, docs → docs-reviewer or docs-optimizer, skill work → skill-creator.
