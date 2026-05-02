---
name: dogfood
description: >
  Qualitative single-run dogfood review of a Construct tool or skill. Use when
  you want to experience a feature as a naive user would, log UX friction in
  real time, and grade the output against the user's literal question. Triggers
  on: "try this as a user", "dogfood X", "use X like a real user would",
  "pretend you don't know the internals", "how does this feel to use". NOT for:
  programmatic regression testing (use eval-harness), pre-ship claim verification
  (use verify-completion), code artifact review (use code-review).
---

# Dogfood

A qualitative, single-run review conducted **from the perspective of a naive
user** — someone who does not know the internals, has never used the feature
before, and is trying to accomplish a real goal.

The value this skill produces comes almost entirely from the discipline of
staying in that posture throughout. The moment you switch to "I know how this
works" you lose the signal.

## When to Use

- You want to know how a tool or skill actually feels to use, not whether it
  technically works
- You suspect UX friction exists but have no concrete evidence yet
- You want output quality graded against a real question, not the system's own
  success metrics
- A new feature shipped and no one has used it as a stranger yet

## Do NOT Use For

| Goal | Use instead |
|---|---|
| Catch regressions across multiple runs | `eval-harness` |
| Verify a completion claim before committing/PR | `verify-completion` |
| Review code artifacts for correctness | `code-review` |
| Read a session transcript and retrospect on it | (separate skill — this one requires driving the tool live) |

## Anti-Patterns

**Reading source mid-session is the failure mode.** The moment you check implementation details, you've broken posture — you can no longer report what a user would experience. If you catch yourself doing it, note it as a finding ("required insider knowledge to proceed") and switch back without using what you read.

Other posture breaks to watch for:
- Guessing at internal behavior to work around an error instead of reporting the error
- Skipping a confusing step because you know what it's supposed to do
- Grading the output against what the system *tries* to answer rather than what was literally asked

## Process

### 1. Establish the Question

Before touching the tool, write down:

- **The user's literal question or goal** — exact words, not a paraphrase
- **What "answered" looks like** — what would need to be true for you to
  say the question was fully addressed

Pin this. Do not revise it mid-session. Everything is graded against it.

### 2. Enter User Posture

Explicitly set your frame before starting:

> "I am a user who wants [goal]. I have not read the source. I do not know
> the implementation. I will try to accomplish this using only the interface."

Do not read source, internal docs, or implementation notes during the session.
If you catch yourself using internal knowledge, note it as a finding.

### 3. Drive the Tool End-to-End

Use the tool or skill exactly as a user would:

- Follow the interface as presented — do not work around friction
- Note every moment of confusion, unexpected behavior, or error **as it
  happens**, in a running log (see format below)
- Do not defer observations to a cleanup pass — real-time capture only

### 4. Grade the Output

When the tool produces its final answer, grade it against the literal question
from Step 1:

- Does it directly address the question?
- Are there obvious gaps — things the question asked about that the output
  omits or underweights?
- Does the output's framing match what was asked, or does it answer a slightly
  different (easier) question?
- Would a user who only read the output know whether their question was
  answered?

**Hunt for gaps the user would not notice.** "Looks complete" is the failure
mode. A polished, confident-sounding output with a coverage gap is worse than
one that hedges — it actively misleads.

> Example: A research session on 1990s EDM produced a confident, well-structured
> summary about commercialization mechanics and sonic standardization. It looked
> thorough. But the user had asked specifically for "key artists and key tracks."
> Grading against the literal question caught it: Moby's *Play*, Underworld's
> *Born Slippy*, Daft Punk's *Homework* — the canonical artifacts of the era —
> were entirely absent. The planner had gone depth-first on chart mechanics
> without a canon-enumeration pass. The output didn't hedge; it just omitted.
> That's the worst case.

### 5. Produce the Report

Four buckets, strictly separated:

**Bugs** — behavior that is broken or incorrect
- The tool errored, returned wrong data, or behaved contrary to its own
  documented contract
- Include: what you did, what you expected, what actually happened
- *Example: `/run` returned `{"error":"Query already has an active job"}` when
  the query had auto-started. `/plan` returned `{"error":"No plan found"}`
  immediately after launch — before the plan had time to populate. Both are
  silent contract violations: the tool's own docs didn't warn about these states.*

**UX Papercuts** — behavior that works but creates friction
- Inconsistent response shapes, confusing timing, unhelpful error messages,
  flows that require insider knowledge
- Include: the moment of friction and why it cost something
- *Example: `/findings` returned a bare array while sibling endpoints returned
  objects with a `status` field. The inconsistent envelope made it fiddly to
  parse responses generically — you had to know which endpoint you'd called.*

**Content Quality** — the answer itself, graded against the literal question
- Coverage gaps (what was asked about that was missed or underweighted)
- Accuracy issues (anything verifiably wrong)
- Framing drift (answered a different question than was asked)
- *Example: A finding "By 2040, EDM is projected to evolve into AI co-creation /
  DAO economics..." stored with confidence 0.8 — perturbation from speculative
  future-state content polluting a historical findings set. A grunge-breakthrough
  finding stored without "this is an analogy" framing. These don't fail loudly;
  they degrade trust slowly.*

**Verdict** — one sentence, four possible values:

| Verdict | When to use |
|---|---|
| **Fully Answered** | All literal asks addressed with appropriate coverage |
| **Partially Answered** | Some asks addressed, others missing or underweighted |
| **Misleading** | Output sounds complete but has a coverage gap the user would not notice |
| **Not Answered** | The literal question was not addressed |

"Misleading" is the worst case — reserve it for outputs that are confidently
framed but materially incomplete. It's qualitatively different from "Partially
Answered" because it doesn't just fail to answer; it causes the user to believe
they were answered when they weren't.

### 6. Deliver the Verdict

After the four buckets, one sentence:

> **Verdict: [Fully / Partially / Misleading / Not Answered]**
> [One sentence explaining why, citing the literal question]

## Output Format

```
# Dogfood: [Tool/Skill Name]
Session date: YYYY-MM-DD
Question: [exact literal question]
"Answered" means: [criterion from Step 1]

## Running Log
[Timestamped or sequenced observations captured in real time]

## Bugs
- [B1] **[title]** — [what happened, expected vs actual]
- ...

## UX Papercuts
- [U1] **[title]** — [friction moment and cost]
- ...

## Content Quality
- [C1] **[title]** — [gap or accuracy issue, tied to literal question]
- ...

## Verdict
[Fully / Partially / Misleading / Not Answered] — [one sentence]
```

## Done When

- Running log captured during live session (not reconstructed after)
- All four buckets populated or explicitly marked "none found"
- Verdict stated against the literal question using the four-value scale
- Report returned as response text (no file write required)
