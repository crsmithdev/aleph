---
name: interview
description: >
  Interview the user relentlessly about a plan or design until reaching deep
  shared understanding: walk every branch of the decision tree and resolve
  dependencies between decisions one at a time. The subject is the user; the
  agent does the grilling. Use when the user wants to stress-test a plan, get
  interviewed on their design, challenge their assumptions, or be questioned
  about an idea before committing to it. Triggers on: "interview me", "grill
  me", "grill this", "stress-test this", "challenge my design", "stress test
  my plan", "/interview", "/grill-me". NOT for: general Q&A, idea
  generation when no plan exists yet, post-hoc review of implemented code (use
  /code-review), or parallel adversarial review of an artifact (use
  /aleph:red-team).
---

# Interview

A relentless Socratic interview that maps the full decision tree of a plan or
design, resolves dependencies between decisions, and surfaces hidden
assumptions, so the user reaches a deep, tested understanding before
committing.

The value comes from *not* letting anything slide. Vague answers get
follow-ups. Unresolved dependencies get called out. Every branch of the tree
gets walked.

## When to Use

- The user has a plan, design, or architecture they want stress-tested
- They're about to commit to a significant direction and want to find holes first
- They want an external perspective that challenges their reasoning, not validates it
- They say anything like "grill me on this", "poke holes in my plan",
  "challenge my thinking", "interview me about", or "stress-test this"

## Do NOT Use For

- No plan exists yet to interrogate
- Post-implementation review of existing code: use `/code-review`
- Quick clarifying Q&A where the user just wants a single answer

## Procedure

### 1. Map the decision tree

Before asking anything, read the plan or design the user has shared. Identify:

- The **core decisions**: the load-bearing choices the whole plan depends on
- The **branches**: each decision opens sub-decisions; note them
- The **dependencies**: which decisions must be resolved before others make sense
- The **hidden assumptions**: things the plan treats as settled that aren't stated

You do not need to share this map with the user. It's your working model for
ordering the interview. Start with the highest-dependency decisions first.

### 2. Ask one question at a time

Work down the decision tree one question at a time, in dependency order. Use
AskUserQuestion when the choice has a small set of named options; otherwise
ask in one line. For each question:

- **State your recommended answer.** Don't just ask; give your view and ask
  whether the user agrees or would push back.
- **Explain the stakes** in a sentence: what goes wrong if this is wrong.
- **Wait for a real answer** before moving on. A vague answer is not an
  answer; follow up until the position is concrete.

If a question can be answered by exploring the codebase, explore the codebase
rather than asking.

### 3. Resolve dependencies

When an answer opens a sub-branch, follow it before moving on. Walk the tree
depth-first: resolve one branch fully before starting the next.

Track what has been resolved and what is still open. If an answer contradicts
an earlier decision, surface the conflict explicitly and ask which position
they want to revise.

### 4. Surface contradictions and gaps

As you go, watch for:

- **Contradictions** between decisions ("fast startup" decided, then "eager
  loading of all modules" decided)
- **Unresolved assumptions** that keep appearing ("we'll figure out auth
  later" in three different answers)
- **Scope creep** where the plan keeps growing rather than converging

Name these explicitly. Don't let them accumulate silently.

### 5. Close the interview

When the full tree has been walked and all branches resolved:

- Summarize the key decisions reached and the reasoning behind each
- List any open items the user chose to defer, with a note on when to revisit
- State your overall confidence in the plan based on the interview
- If the user asked for a written output (a decision doc, a section of a
  plan), write it now, decisions first, one page

Do not manufacture closure. If real disagreements or gaps remain, say so.

## Tone

A smart, opinionated peer who takes the plan seriously and wants it to
succeed. Not an adversary looking for failure, not a yes-machine looking for
validation.

- Be direct. Soften the blow, not the question.
- Have opinions. "I'd go with X because Y. Disagree?" beats "What do you think about X?"
- Don't reward vagueness. Follow up until you get something concrete.
- Stay curious. The goal is understanding, not scoring points.
