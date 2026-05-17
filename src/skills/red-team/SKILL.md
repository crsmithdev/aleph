---
name: red-team
description: >
  Dispatch several subagents in parallel to adversarially review a plan,
  proposal, design doc, RFC, or PR description from multiple angles — each
  agent reads the artifact AND the actual code/files it touches, applies the
  interview branch-walking methodology, and returns sharp, citation-backed
  questions and gaps. The orchestrator then synthesizes findings into a
  prioritized report (fatal / defects / smells / cheaper alternatives). Use
  this skill when the user wants a plan stress-tested adversarially without a
  back-and-forth interview, when a proposal is about to be committed to, or
  when you want a red team pass on your own design before shipping.
  Triggers on: "red team this", "red-team this", "/red-team", "grill yourself",
  "/grill-yourself", "have agents grill the plan", "tear this plan apart",
  "adversarial review of this plan", "stress test this with subagents".
  NOT for: direct interview with the user (use /interview), post-implementation
  code review (use /code-review), bug investigation (use /code-debug).
---

# Red Team

Spawn a panel of adversarial reviewers in parallel to interrogate a plan or
proposal from independent angles. Each reviewer reads the artifact, verifies
its claims against actual source, applies the [[interview]] methodology
mentally (walk every branch, demand specifics, surface dependencies), and
returns a numbered list of sharp questions and identified gaps with file
citations.

This is the parallel-adversarial companion to [[interview]]. Where `interview`
walks one question at a time with the user, `red-team` interrogates the
*artifact* in parallel — no user interaction required between dispatch and
synthesis.

## When to Use

- The user has written or shared a plan / proposal / design doc / RFC / PR
  description and wants it stress-tested before committing
- The user says "red team this," "tear this apart," "stress-test this with
  subagents," "have agents grill the plan," "grill yourself on this"
- You just produced a plan in this session and want to pressure-test it
  before recommending it

## Do NOT Use For

- Interactive grilling where the user is the subject — use [[interview]]
- Reviewing already-implemented code — use `/code-review`
- Investigating a bug or failure — use `/code-debug`
- Brainstorming when no plan exists yet — there must be an artifact to grill

---

## Procedure

### 1. Locate and read the artifact

Find the plan, proposal, design doc, or PR description the user is referring
to. Read it in full. If you cannot find it, ask the user for the path or
URL — do not invent.

### 2. Choose the review lenses

Default to **four parallel lenses** (one subagent each). Adapt the set to fit
the artifact — drop a lens that doesn't apply, add a lens that the artifact
specifically demands (e.g., security for an auth proposal, schema migration
for a data model change).

Default lenses:

1. **Correctness & concurrency** — race conditions, lock ordering, partial
   writes, idempotency, error propagation, schema drift, atomicity
   boundaries
2. **Performance claims & measurement** — verify every quantitative claim
   against actual measurement; demand methodology; surface unmeasured
   assumptions; check the headline benefit is real
3. **Operational / failure modes** — recovery, rollback, migration, backup,
   silent-failure surfaces, dual-pipeline risk, schema versioning, dead
   tables, integration with existing infra
4. **YAGNI / simpler alternatives** — is the problem real and measured? what
   cheaper interventions weren't compared? is the headline benefit
   proportional to the LOC added? does this violate "minimal, concise" or
   "no orphaned features"?

### 3. Dispatch all reviewers in a single message

Send **one message containing one Agent tool call per lens**, in parallel —
not sequential. Each prompt must include:

- The exact path of the artifact to read
- A specific list of source files / paths each reviewer should read to verify
  the artifact's claims (don't make them go hunting)
- A statement that they should apply the `interview` methodology (walk every
  branch, demand specifics, force dependency resolution)
- The specific question categories for that lens (bulleted, concrete)
- An instruction to produce ~12-25 numbered questions/issues with file:line
  citations and to **not propose fixes** — the goal is surfacing gaps, not
  solving them
- A length cap (under 800 words is a good default)

Use `subagent_type: "general-purpose"` unless the artifact maps to a
specialist (e.g., `security-audit` for an auth proposal). Run them in the
foreground — you need their findings to synthesize.

### 4. Synthesize the findings

When all reviewers return, group their findings by severity. Don't just
concatenate; cluster duplicates, elevate findings that multiple reviewers
independently flagged, and lead with what kills the plan:

- **Fatal** — defects that invalidate the plan as written. Wrong target,
  unmeasured premise, broken correctness invariant, existing infra already
  solves it.
- **Correctness defects** — implementation-level bugs in the plan's code
  sketches that would ship if executed verbatim (race conditions, missing
  UNIQUE constraints, non-atomic offset updates, swallowed exceptions, etc.)
- **Architectural smells** — design choices that aren't fatal but signal the
  plan needs revision (dead schema, no forcing function for cleanup phases,
  coupling concerns, dual write paths)
- **Cheaper alternatives** — interventions the plan didn't compare against,
  ranked by LOC / risk

Cite specific files and line numbers throughout the synthesis — the user
should be able to verify every claim in two clicks.

### 5. Keep the agents reachable

End by listing the live agent IDs so the user can `SendMessage` back to any
reviewer to push back on a finding, ask for more depth, or have them
re-evaluate after a plan revision. Do not auto-dismiss them.

---

## Tone

The reviewers are adversarial — their job is to surface flaws, not validate.
The synthesis should be direct and unhedged. If the verdict is "don't land
this," say so. If multiple reviewers independently reached the same fatal
finding, name that convergence — independent confirmation matters.

Do **not** soften findings to make the plan's author feel better. The value
of this skill comes from honest, evidence-backed critique. If a finding is
wrong, the author will push back via SendMessage and the reviewer can
update.

## Adapting the lens set

Examples of when to deviate from the four-lens default:

| Artifact type | Replace or add |
|---|---|
| Auth/authz proposal | Add a `security-audit`-style reviewer |
| Data model / schema migration | Add a migration & backfill reviewer |
| New external API surface | Add a backwards-compatibility reviewer |
| UI/UX proposal | Add a `design-audit`-style reviewer |
| One-page tactical fix | Drop to 2 lenses (correctness + YAGNI) |
| Cross-cutting platform change | Add an integrations / blast-radius reviewer |

Match the panel to the artifact. Don't fire four lenses just because the
default says four.
