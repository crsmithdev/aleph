# Memory loop mocks

Chris asked on 2026-11-18 for a UI that shows each lesson, its signals, the decision, who made it and what it changed,
and then for one layout of memory, sessions and lessons that drops nothing and puts what needs him first. Not built.

Open `index.html`. Each page is self-contained: it inlines `ui/app.css` and draws with the helpers of
`ui/views/lib/html.js`, filled with data read from `aleph.db`, git and the UI at :3020 on 2026-11-18.

| File | Shows |
|---|---|
| `lessons-1.html` | Round 1, option 1: a `#/lessons` page with four numbers, a ledger of decided lessons and the Always rules |
| `lessons-2.html` | Round 1, option 2: a record page for aleph-2956 with a timeline |
| `lessons-3.html` | Round 1, option 3: a fold on the Automation Lessons card |
| `memory-1.html` | Round 2, option 1: a Lessons tab on Memory |
| `memory-2.html` | Round 2, option 2: a Review tab with Needs you, Changed without you and one item chain |
| `split-status.html` | Round 3: Status holds every decision, waiting and made without Chris |
| `split-memory.html` | Round 3: Memory Notes, with the chain of `identity/CLAUDE.md § Verification` open |
| `split-loop.html` | Round 3: Memory › Loop, with signals by source, monitor findings and every lesson |
| `split-log.html` | Round 3: Memory › Log, one log for writes, decisions and rule acts |
| `split-automation.html` | Round 3: Automation as knobs only: schedules, Always rules, controls, held paths |
| `policy-status.html` | Round 4: Status with Asks and Policy changes side by side, and decisions made without Chris split by kind |
| `policy-review.html` | Round 4: Review › Waiting, issue.3302 in five steps: change, readers, why, outcome and check date, decide |
| `policy-due.html` | Round 4: Review › Due, aleph-1203 at its check date: 8 misses before, 59 after |
| `r5-status.html` | Round 5: the live Status page, with a wider Herald, Events and Detail tabs, and policy alerts that link to Automation |
| `r5-automation.html` | Round 5: Automation with Review, Checks due and Decided without you above the round 3 knobs |
| `r6-self.html` | Round 6, hypothetical: Status of a self-managed factory |
| [lessons-proposal.md](lessons-proposal.md), [memory-proposal.md](memory-proposal.md) | The decisions, the data changes and what was not verified |

## Decisions

- Show decided lessons, not only open ones, because Principle 3 says each fact about a change is visible.
- Put "needs you" and "changed without you" first, because Principle 3 puts anything waiting for Chris at the top.
- Show four numbers, each with the action it drives, after the datavis skill.
- Draw with the Kit helpers and `ui/app.css` tokens, after `docs/design.md`.
- Add no store: the page reads the `corrections` row and the events table, after Principle 5.

## Round 4 decisions

Chris proposed two kinds of decision on 2026-11-18: an ask changes one run, and a policy change alters future runs.

- Classify by scope, not origin, because a diff to a SECURITY_PATH (`jobs/lib/gates/gate.ts:154`) changes future runs. held-path:aleph landed 17 such diffs in 7 days.
- Give a policy change no Always button, because a standing grant is itself a policy change. This contradicts the vault rule "Every Needs-You Item Gets An Always Button", which needs an exception.
- Review a policy change in five steps: the change and where it lands, who reads it, why, the outcome and a check date, and the decision. Devin and Warp gate agent-made memory and skill edits per change, by a person.
- Give each approval a check date, and bring the item back as Due on that date. GitHub Copilot memory expires after 90 days without validation, and feature-flag practice requires an owner and an expiry date.
- Offer Shadow before Approve, because OPA Gatekeeper rolls out a policy as dryrun, then warn, then deny.
- Keep the gate on a path the change cannot edit, because the Darwin Gödel Machine edited its own workflow to bypass its hallucination check.
- Split Decided without you by kind, so policy rows read "should be 0".

Sources: https://docs.devin.ai/use-cases/gallery/scheduled-knowledge-maintenance, https://claude.com/blog/how-warp-builds-self-improving-agents-on-claude, https://docs.github.com/en/copilot/concepts/agents/copilot-memory, https://cloud.google.com/anthos-config-management/docs/how-to/auditing-constraints, https://earthly.dev/lunar/guardrails/feature-flags/, https://arxiv.org/html/2505.22954v3.

Not verified: the 53 decisions and their split by reason, carried from round 3, whose header said 52. The before and after counts of the Watched lessons, carried from round 3. The 65 review runs, from the 11/17 monitor.

## Round 5 decisions

Chris asked on 2026-11-18 to keep Status to what needs him, and to merge Review and Decided without you into Automation.

- Status is a snapshot of the live page at :3020, so nothing on it is dropped. Its chart is an image of the live canvas.
- Alerts show in the Herald's Events tab, as now. A policy alert links to its item on Automation, where the diff is.
- The Detail tab is for drill-ins from Agent Time, Pipeline and the other cards. This mock draws only the tab.
- The Herald widens from clamp(480px, 38%, 600px) to clamp(560px, 44%, 720px).
- Checks due lists 5 lessons whose 14-day check passed. Land dates come from the `Issue:` trailers in git.
- Ideas and Explore are out of the nav, because they are going away.
- Agent Time and Active Issues share the first row, and Pipeline is second. Chris asked for this to free the third row.
- The third row is a Decisions card in the form of Agent Time. It shows 53 decisions in 7 days, 18 of them policy changes made without Chris, and links to Automation. The split by who decided comes from the round 3 rows: 44 by rule, 9 by the director, 0 by Chris.
- The chart is the live page's canvas, drawn again at 330px wide.

Not verified: the before and after counts of the lessons, carried from round 3. Whether the Detail tab fits the drill-in proposal, which this mock does not draw.

## Round 6 decisions (hypothetical)

Chris asked on 2026-11-19 for the Status page of a self-managed factory.

- The scorecard shows a target under each number, because a factory that steers itself needs a goal to steer to. The targets are made up.
- Self-changes is the first card. Each change runs 14 days, then its measure keeps or reverts it. The 6 lessons and their counts are real. The reverts are what that rule would have done.
- Guardrails list what the factory may not change: its gate, roles, hooks and identity, the trial count, spend, the live cap and the revert limit. A change inside the boundary goes to Chris, because the factory may not judge a change to its own judge.
- The Herald shows one escalation, a3302, and the factory's own acts as events.
- Agent Time and Active Issues share a row, and Pipeline stays full width.

Not verified: every target and limit, which are made up for the mock.
