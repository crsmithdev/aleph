---
name: grill-me
description: >
  Grill the user relentlessly about a plan, decision, or idea until reaching
  shared understanding. Maps the plan as a design tree and asks the whole
  frontier of unblocked decisions each round, with a recommended answer per
  question. Use when the user wants to stress-test their thinking or says
  "grill me", "grill this", "interview me", "stress-test this", "challenge my
  design", "/grill-me". NOT for: general Q&A, idea generation when no plan
  exists yet, review of implemented code (use /code-review), or parallel
  adversarial review without the user in the loop (use /aleph:red-team).
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Before the first round, name the **givens**: everything the plan treats as fixed and does not change. The schema under a UI change, the API a client calls, a library, a data flow. For each given, say what the plan looks like if that given moves, and what the move costs. A given that would make the plan smaller if it moved is a question in the first round, with the smaller plan as the recommended answer. The user decides which givens stay fixed. The rest are the root of the tree.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
**Q1 - <question title>**: <question body, might be multiple paragraphs, including multiple choices>

Recommended: <your recommended answer>

---

**Q2 - <question title>**: <question body, might be multiple paragraphs, including multiple choices>

Recommended: <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding. When they do, offer `/aleph:to-spec` to write the decisions down.

Adapted from Matt Pocock's `grilling` skill (github.com/mattpocock/skills).
