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

Ask only when the answer changes what gets built. When it does not, settle the decision yourself: state your default and its reason in one line, and list it as settled in the next summary, where the user can correct it. A preference is always the user's: anything the user will see or feel, such as a prompt, a click, a label or a default, goes to the user as a question, even when you have a default.

1. **Explain it in full as regular output.** Start with the counter, `(n/total)`: `n` is this question's number, and `total` is `n` plus every open question you know of now. The total grows when an answer opens new branches; say so when it does. Then give: what the decision is, why it matters, the options and their trade-offs (a table when there are more than two), and your recommendation with its reason. If you looked something up for it, say what you found.
2. **Ask it through AskUserQuestion.** Put the counter in the question text. Short option labels, a one-line description each, your recommended option first and marked "(Recommended)", so accepting it is one pick. Add a **Defer** option when the decision can wait without blocking the rest.
3. **Wait for the answer.** If the answer leans on convention instead of a preference ("best practice", "usually", "the standard way", "probably", "I guess"), ask once before you settle it: "If you did not have to justify this to anyone, what would you want?" Say in one line what it settles, and which questions it opens or closes. Recompute the frontier, and go to the next question.

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

The session ends when the frontier is empty: every branch settled or deferred, nothing left silently assumed. It also ends when you can predict the user's answers to the next three questions you would ask: settle those as defaults. If three answers in a row teach you nothing new, say that something basic seems to be missing, and ask what it is. Show the final summary: every settled decision with its reason, every deferred item, and the open risks you noticed but did not explore. Do not act on it until the user confirms you have reached a shared understanding. Only an explicit yes confirms. "Sounds good", "whatever you think" and silence do not: restate the summary and ask again.

After the yes, in a repo, record what settled: call the Skill tool with `aleph:domain-modeling`, and write each settled term to the glossary and each decision that passes its three tests as an ADR, in one commit on a worktree branch. Write nothing when none qualifies, and say so. Ask no new question after the yes: where the write needs a choice, take your recommendation and name it in your reply. Then offer `/aleph:to-spec` to write the decisions down.

Adapted from Matt Pocock's `grilling` skill (github.com/mattpocock/skills @4ae2317), with the question types, the periodic summary and the deferred state from usirin's grill-me (gist.github.com/usirin/0f01923f7b2126b0cce817f9f8d97788).
