---
name: plan
description: >
  Write an implementation plan for a feature or code change — the execution
  contract that names every file that changes, the order of changes, the
  verification command per task, and the rollback path. Reads an existing
  sketch when one is provided, otherwise builds the premise from the
  conversation. Writes to `~/.aleph/plans/<slug>.md`. Use when the user
  has a concrete change in mind and wants the work decomposed into
  commit-ready tasks: "write a plan", "/plan", "plan this out", "plan the
  implementation", "draft a plan for", "what's the plan", "decompose this",
  "break this into tasks". NOT for: discovery / framing an idea (use
  `/sketch`); reviewing existing code (use `code-review`); brainstorming
  without a concrete change (use `/sketch`). A plan answers the HOW; the
  sketch answered the WHAT.
---

# Plan

Produce an execution contract: every file that changes, in what order,
with the verification each step is judged against.

## When to Use

- The user has a concrete change in mind and wants it decomposed
- A sketch exists and is ready to turn into work
- The user says "/plan", "write a plan", "plan this", "break it down"

## Do NOT Use For

- Capturing an idea before committing to it — use `/sketch`
- Reviewing already-implemented code — use `code-review`
- Brainstorming with no target — use `/sketch`

## Inputs

`$ARGUMENTS` may be:

- A sketch path (e.g. `~/.aleph/sketches/inbox-share.md`) — read it and
  use it as the premise
- A short subject phrase — build the premise from the conversation
- Empty — infer the subject from the conversation; ask one short question
  if the target is genuinely ambiguous

## Procedure

### 1. Locate inputs

If `$ARGUMENTS` names a file, read it. Otherwise, summarize the target in
3–6 words for the title and slug. If a corresponding sketch exists
(`~/.aleph/sketches/<slug>.md` or similar), read it and lift the
premise.

### 2. Resolve output

Read `~/.claude/aleph/core/aleph.config.json` and pick
`plans.outputDir`. Expand `~` to `$HOME`. `mkdir -p` if missing. Default:
`~/.aleph/plans`. Slugify the subject for the filename. If the slug
collides, suffix (`-v2`, `-revised`) — do not silently overwrite.

### 3. Read the affected code

A plan that doesn't reference real file paths is fiction. Before writing
tasks:

- Grep / read the modules the change touches
- Note current call sites that need updating
- Confirm any assumption the sketch made ("module X already does Y") is
  actually true

If a load-bearing assumption is wrong, stop and flag it — don't paper over
it in the plan.

### 4. Draft the plan

Use this skeleton. Add sections the change demands; cut sections that have
nothing to say.

```markdown
# Plan — <subject>

## Premise

One paragraph: what we're building and why. Lift from the sketch if one
exists; otherwise summarize the user's intent. No more than ~120 words.

## Touch list

| File | Change | Notes |
|---|---|---|
| `src/foo/bar.ts` | edit | extract `parseFoo` into helper |
| `src/foo/bar.test.ts` | edit | add cases for new helper |
| `src/foo/helpers.ts` | new | host the extracted helper |

Every file that changes must appear in the table — no surprises later.

## Tasks

Numbered, commit-sized. Each task should be landable on its own.

1. **<short imperative>**
   - **Files:** `src/foo/bar.ts`, `src/foo/helpers.ts`
   - **Change:** one sentence, concrete
   - **Verify:** the command that proves this task landed
     (e.g. `bun test src/foo`, `bun run --cwd src/ui ui:smoke`)
   - **Done when:** the observable result that defines success

2. ...

## Dependencies

Which tasks block which. If everything is sequential, say so. If some can
parallelize, name the parallel set.

## Verification gate

The single command (or short ordered list of commands) that proves the
whole plan landed:

```bash
bun test.ts && bun run --cwd src/ui ui:smoke
```

## Rollback

The single revert path if the plan turns out wrong mid-flight. For most
plans this is "revert the feature branch" — say so explicitly. For plans
that touch shared state (DB migrations, persisted config), name the
specific undo step.
```

### 5. Save

Write to `<outputDir>/<slug>.md` via the `Write` tool.

### 6. Report

One line:

```
→ <absolute-path>
```

Then, in one additional line, suggest the next move:

- "Ready to execute. Use `/git` to set up the branch, then walk the tasks."
- Or if the touch list revealed a gap: "Open question in task 3 — sketch
  may need a revision before this is safe to execute."

## Guardrails

- **No file path is hypothetical.** Every entry in the Touch list must
  resolve against the current tree. If a target doesn't exist yet, mark it
  `new`.
- **Every task has a verify and a done-when.** A task without a check is
  not a task.
- **No estimates or owners.** Plans are about *what* and *what proves it
  worked*, not about scheduling.
- **No narrative.** Tables and bullets, not paragraphs. The plan is a
  contract, not a memo.
- **Don't invent acceptance criteria the user didn't ask for.** Lift them
  from the sketch or from the user's request; don't add aspirational ones.

## After the plan

The plan IS the execution contract. The existing skills do the work:

| Plan step | Skill / command |
|---|---|
| Set up branch / worktree | `/git` |
| Walk the tasks, edit files | Direct edits, or `Agent(subagent_type: code-review)` per task |
| Review each commit | `/code-review` |
| UI verification | `/code-test` or `bun run ui:smoke` |
| Hit a bug | `/debug` |
| Autonomous iteration | `/ralph-loop` |
| Land at the end | `/git` |

There is no `/execute-plan` skill — executing a plan is reading it and
dispatching to skills that already exist. The plan's verification gate is
how you know you're done.
