---
name: grill-me
description: >
  Grill the user relentlessly about a plan, decision, or idea until reaching
  shared understanding. Maps the plan as a design tree and asks one
  unblocked decision at a time, explained in detail, with a recommended
  answer. Use when the user wants to stress-test their thinking or says
  "grill me", "grill this", "interview me", "stress-test this", "challenge my
  design", "/grill-me". NOT for: general Q&A, idea generation when no plan
  exists yet, review of implemented code (use /code-review), or parallel
  adversarial review without the user in the loop (use /aleph:red-team).
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Before the first round, name the **givens**: everything the plan treats as fixed and does not change. The schema under a UI change, the API a client calls, a library, a data flow. For each given, say what the plan looks like if that given moves, and what the move costs. A given that would make the plan smaller if it moved is the first question, with the smaller plan as the recommended answer. The user decides which givens stay fixed. The rest are the root of the tree.

Ask **one question at a time**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. From the frontier, pick the question whose answer unblocks the most of the tree.

For each question:

1. Explain it in detail as regular output: what the decision is, why it matters, the options and their trade-offs (a table when there are more than two), and your recommendation with its reason.
2. Put the decision to the user with AskUserQuestion: short option labels, a one-line description each, your recommended option first. The explanation stays in step 1, because the question body is too small for it.
3. Wait for the answer. Say what it settles, recompute the frontier, and go to the next question.

Each answer reshapes the tree: settled decisions push the frontier outward and unblock the questions that depended on them.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask another frontier question now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding. When they do, offer `/aleph:to-spec` to write the decisions down.

Adapted from Matt Pocock's `grilling` skill (github.com/mattpocock/skills).
