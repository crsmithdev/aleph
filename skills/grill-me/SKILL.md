---
name: grill-me
description: >
  Grill the user about a plan, decision or idea until you reach shared
  understanding. Use when the user says "grill me" or "interview me", or wants
  a plan stress-tested in conversation. NOT for: general Q&A, ideas with no
  plan yet, implemented code (use /aleph:code-review), or review without the user in
  the loop (use /aleph:red-team).
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it. Make each answer cheap: the user reads one explanation, then picks one option.

## Before the first question

Name the **givens**: everything the plan treats as fixed. The schema under a UI change, the API a client calls, a library, a data flow. For each given, say what the plan looks like if that given moves, and what the move costs. A given that would make the plan smaller if it moved is the first question, with the smaller plan as the recommended answer. The user decides which givens stay fixed. The rest are the root of the tree.

Then find the branches. For each part of the plan, ask yourself the **question types**: feasibility (can it work under its constraints?), dependency (what must be settled first?), edge case (what happens when?), alternative (why this over that?), scope (in, or deferred?), ordering (what comes first?), failure mode (how does it fail, and how does it recover?). Each type that has no answer in the plan is a branch.

## Each question

The **frontier** is every open decision whose prerequisites are settled: the questions you can ask now without guessing at answers you have not heard. From the frontier, pick the question whose answer unblocks the most of the tree. Ask one question per turn.

1. **Explain it in full as regular output.** Start with the counter, `(n/total)`: `n` is this question's number, and `total` is `n` plus every open question you know of now. The total grows when an answer opens new branches; say so when it does. Then give: what the decision is, why it matters, the options and their trade-offs (a table when there are more than two), and your recommendation with its reason. If you looked something up for it, say what you found.
2. **Ask it through AskUserQuestion.** Put the counter in the question text. Short option labels, a one-line description each, your recommended option first and marked "(Recommended)", so accepting it is one pick. Add a **Defer** option when the decision can wait without blocking the rest.
3. **Wait for the answer.** Say in one line what it settles, and which questions it opens or closes. Recompute the frontier, and go to the next question.

A **deferred** branch is closed for this session: it goes on the deferred list, and the questions that depend on it wait with it.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (files, tools, a running system), dispatch a sub-agent with a fresh context to find it. Do not ask the user for anything you can look up. Do not block on it: a running lookup is an unsettled prerequisite, so only the questions downstream of it wait; ask another frontier question now. The _decisions_ are the user's: put each to them and wait.

## Every 5 questions

Show where the session stands, before the next question:

```
Settled: <decision>: <choice>, because <reason>   (one line each)
Deferred: <decision>
Open: <the questions left, in the order you will ask them>
```

The user can correct a settled line here. A correction reopens that decision and the ones that hang off it.

## The end

The session ends when the frontier is empty: every branch settled or deferred, nothing left silently assumed. Show the final summary: every settled decision with its reason, every deferred item, and the open risks you noticed but did not explore. Do not act on it until the user confirms you have reached a shared understanding. When they do, offer `/aleph:to-spec` to write the decisions down.

Adapted from Matt Pocock's `grilling` skill (github.com/mattpocock/skills @4ae2317), with the question types, the periodic summary and the deferred state from usirin's grill-me (gist.github.com/usirin/0f01923f7b2126b0cce817f9f8d97788).
