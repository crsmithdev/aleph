---
name: red-team
description: >
  Dispatch several subagents in parallel to adversarially review a plan,
  proposal, design doc, RFC, or PR description from multiple angles. Each
  agent reads the artifact AND the actual code it touches, walks every branch
  of its decisions, and returns sharp, citation-backed questions and gaps. The
  orchestrator synthesizes a prioritized report (fatal / defects / smells /
  cheaper alternatives). Use when the user wants a plan stress-tested without
  a back-and-forth interview, when a proposal is about to be committed to, or
  when you want a red team pass on your own design before shipping. Triggers
  on: "red team this", "red-team this", "/red-team", "grill yourself", "have
  agents grill the plan", "tear this plan apart", "adversarial review of this
  plan", "stress test this with subagents". NOT for: interviewing the user
  (use /aleph:grill-me), reviewing implemented code (use /code-review), bug
  investigation (use /debug).
---

# Red Team

Spawn a panel of adversarial reviewers in parallel to interrogate a plan or
proposal from independent angles. Each reviewer reads the artifact, verifies
its claims against actual source, walks every branch of its decisions, and
returns a numbered list of sharp questions and identified gaps with file
citations.

This is the parallel companion to `/aleph:grill-me`. Where the interview
walks one question at a time with the user, red-team interrogates the
*artifact* in parallel, with no user interaction between dispatch and
synthesis.

## When to Use

- The user has a plan, proposal, design doc, RFC, or PR description and
  wants it stress-tested before committing
- The user says "red team this", "tear this apart", "stress-test this with
  subagents", "have agents grill the plan", "grill yourself on this"
- You just produced a plan in this session and want to pressure-test it
  before recommending it

## Do NOT Use For

- Interactive grilling where the user is the subject: `/aleph:grill-me`
- Reviewing already-implemented code: `/code-review`
- Investigating a bug or failure: `/debug`
- Brainstorming when no plan exists yet. There must be an artifact to grill.

## Procedure

### 1. Locate and read the artifact

Find the plan, proposal, design doc, or PR description the user means. Read
it in full. If you cannot find it, ask for the path or URL. Do not invent.

### 2. Choose the review lenses

Default to **four parallel lenses**, one subagent each. Adapt the set to the
artifact: drop a lens that doesn't apply, add one the artifact demands
(security for an auth proposal, migration for a schema change).

Default lenses:

1. **Correctness and concurrency**: race conditions, lock ordering, partial
   writes, idempotency, error propagation, schema drift, atomicity boundaries
2. **Claims and measurement**: verify every quantitative claim against actual
   measurement; demand methodology; surface unmeasured assumptions; check the
   headline benefit is real
3. **Operational and failure modes**: recovery, rollback, migration, backup,
   silent-failure surfaces, dual-pipeline risk, integration with existing infra
4. **YAGNI and simpler alternatives**: is the problem real and measured? what
   cheaper interventions weren't compared? is the benefit proportional to the
   code added?

### 3. Dispatch all reviewers in a single message

Send **one message containing one Agent tool call per lens**, in parallel.
Each prompt must include:

- The exact path of the artifact to read
- A specific list of source files each reviewer should read to verify the
  artifact's claims (don't make them hunt)
- The instruction to walk every branch of every decision and demand specifics
- The question categories for that lens, as concrete bullets
- An instruction to produce 12 to 25 numbered questions or issues with
  file:line citations and to **not propose fixes**
- A length cap (under 800 words is a good default)

Use `subagent_type: "general-purpose"` unless a specialist agent exists for
the artifact's domain. Run them in the foreground; you need their findings to
synthesize.

### 4. Synthesize the findings

When all reviewers return, group findings by severity. Don't concatenate:
cluster duplicates, elevate findings that multiple reviewers independently
flagged, and lead with what kills the plan.

- **Fatal**: defects that invalidate the plan as written. Wrong target,
  unmeasured premise, broken invariant, existing infra already solves it.
- **Correctness defects**: bugs in the plan's code sketches that would ship
  if executed verbatim
- **Architectural smells**: choices that aren't fatal but signal revision is
  needed (dead schema, no forcing function for cleanup, dual write paths)
- **Cheaper alternatives**: interventions the plan didn't compare against,
  ranked by code and risk

Cite files and line numbers throughout. The user should be able to verify
every claim in two clicks.

### 5. Keep the agents reachable

End by listing the live agent IDs so the user can `SendMessage` back to any
reviewer to push back on a finding, ask for depth, or re-evaluate after a
revision. Do not auto-dismiss them.

## Tone

The reviewers are adversarial: their job is to surface flaws, not validate.
The synthesis is direct and unhedged. If the verdict is "don't land this",
say so. If several reviewers independently reached the same fatal finding,
name that convergence.

Do **not** soften findings to spare the author. If a finding is wrong, the
author pushes back via SendMessage and the reviewer updates.

## Adapting the lens set

| Artifact type | Replace or add |
|---|---|
| Auth/authz proposal | Add a security reviewer |
| Data model / schema migration | Add a migration and backfill reviewer |
| New external API surface | Add a backwards-compatibility reviewer |
| UI/UX proposal | Add a design reviewer |
| One-page tactical fix | Drop to 2 lenses (correctness + YAGNI) |
| Cross-cutting platform change | Add a blast-radius reviewer |

Match the panel to the artifact. Don't fire four lenses because the default
says four.
