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
| [lessons-proposal.md](lessons-proposal.md), [memory-proposal.md](memory-proposal.md) | The decisions, the data changes and what was not verified |

## Decisions

- Show decided lessons, not only open ones, because Principle 3 says each fact about a change is visible.
- Put "needs you" and "changed without you" first, because Principle 3 puts anything waiting for Chris at the top.
- Show four numbers, each with the action it drives, after the datavis skill.
- Draw with the Kit helpers and `ui/app.css` tokens, after `docs/design.md`.
- Add no store: the page reads the `corrections` row and the events table, after Principle 5.
