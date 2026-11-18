# Memory, sessions and lessons: one information architecture

## Decisions

1. Recommend option 2 as the target and ship it in two steps. Step 1 is option 1 (a Lessons tab). Step 2 adds Review, the item chain and the one log.
2. Treat the learning loop as a chain over the existing item model: source, signal, lesson, decision, change, outcome. Do not add a store.
3. Put "needs you" and "changed without you" first on Memory. Keep Status for live asks.
4. Keep Sessions as the evidence page. Add a signal count and memory reads to each session.
5. Remove the Lessons card from Automation. It becomes a link. Rules stay on Automation for grant and revoke.
6. Make the five data changes below first. Without them the page shows "Unknown" for who decided.

## Code and the 2026-11-01 decision differ

- The decision says `#/agents` replaces the Tools, Skills and Sessions lists. The code routes the merged page to `#/sessions` (`ui/views/sessions.js:11`). Its header still says "The Agents view" (`sessions.js:1`). `#/agents`, `#/activity` and `#/skills` redirect to it (`sessions.js:28-34`).
- `#/factory/agents` is a different page, the factory roles (`ui/views/factory-agents.js:156`). The word "Agents" now names two pages.
- The decision says Memory is a type board. Commit 6251b623 rebuilt it as tabs Notes, Health, Log plus a Needs-you strip (`ui/views/memory.js:14,192`). The vault note has no supersede line. Unverified: whether `docs/design.md` was updated to match.
- The Needs-you strip sends open lessons to `#/automation` (`ui/views/lib/memory-health.js:36`), so a Memory reader leaves Memory to act.

## Inventory (what shows, what drops)

| Thing | Page | Drops |
|---|---|---|
| Wiki notes, 604 (333 gotcha, 208 decision, 43 project, 11 concept, 9 entity) | Memory Notes, `#/memory/:title`; Health | Read history: recall keeps the last date only (vault decision) |
| MEMORY.md, core lines (aleph 24, global 8) | Health, Start Context | Why a line exists; the line's origin |
| CLAUDE.md sections, skills, hooks | Notes as `procedural` items (`ui/memory-items.ts:117,133,137`); skill detail page | The lesson behind each line; a removed line (aleph-942, commit 31bbcd8e) leaves no trace |
| Lessons | open and proposed only (`memory-items.ts:141`); Automation Lessons card; Ask card | 22 decided lessons, their signals, who decided, the outcome |
| Signals, 790 | Ask card, Technical details | All after the decision; duplicates are not removed |
| Always rules | Automation Rules table | Revoked grants, what each did, security flag; firings only in the Automation log |
| Handoffs, 189 files | Notes, `working` type (`memory-items.ts:150`) | Which session wrote one |
| Episodes, 1,801 pages | Automation, Episodes chart; Notes | Pruned after 90 days (`docs/data-model.md:223`) |
| Sessions (Langfuse) | `#/sessions`, `#/sessions/:id`, context inspector; also `episodic` items (`memory-items.ts:174`) | Link from a session to the signals and writes it caused |
| Monitor report | Automation, Monitor card (`ui/views/gates.js`, `renderMonitor`) | Not on Memory; findings have no action |
| Memory log (writes, recalls, misses) | Memory Log tab | Decisions and rule acts are in another log |

## Model

There are two lifecycles, not one.

- Knowledge: write, offer, read, decay. It covers notes, handoffs and episodes. Owner: the vault and `aleph memory`.
- Learning loop: signal, lesson, decision, change, outcome. Owner: `jobs/lib/learning/corrections.ts`. Its change lands as an item of the first lifecycle (a CLAUDE.md line, a skill, a hook or a check).

One read model already joins them: `ui/memory-items.ts` gives every item `{type, source, key}` (`memory.js:64`). The loop connects to it by four keys.

| Key | Owner | Joins |
|---|---|---|
| `l-<hash>` (lesson id) | `corrections.ts` | lesson to its signals |
| `aleph-NNN` (issue) | work store | lesson to Ask, spec, commits |
| commit hash | landing | change to item |
| rule key `reason[:project]` | `ask.ts:223` | Always rule to its acts |

Missing joins: signal to session id (`Signal` holds `id, source, at, quote, link`, `corrections.ts:30`), lesson to decider, lesson to land commit, rule act to rule key. These four are the data changes.

If the chain exists, three surfaces collapse: the Automation Lessons card, the lessons half of Memory items, and the Ask card's signal list. Their content becomes one record.

## Options

| Option | What changes | Agent minutes |
|---|---|---|
| 1: Lessons tab (`memory-1.html`) | One tab on Memory with ledger, four numbers and Always rules. Needs strip gets an "unasked" chip. Derived from today's data plus the first two data changes. | 160 |
| 2: Review, Loop, chain (`memory-2.html`) | Option 1 plus a Review tab (needs, changed without you, monitor), a Loop tab, the chain on every procedural item in Library, one log with decisions and rule acts, and signals on Sessions. | 420 total, 260 beyond option 1 |

Recommendation: ship option 1, then option 2. Option 1 shows the biggest gap (decided lessons, Always acts) in about 160 minutes. Option 2 repeats no work: it reuses the same fields.

## Pages (option 2)

| Page | Reason | You act | Number |
|---|---|---|---|
| Status | Live asks and holds need an answer now. | Approve, answer | Asks waiting |
| Memory › Review | Chris sees what needs him and what changed without him in one place. | Approve a lesson, revoke a rule | 9 needs; 25 unasked, 17 on security paths |
| Memory › Library | Every item stays reachable, and its chain shows. | Edit, archive, promote | 124 of 604 never offered in 7 days |
| Memory › Loop | The lesson ledger and rule grants show whether the loop works. | Promote a missed line to a check | Missed 3 of 3; against advice 4 of 4 |
| Memory › Health, Log | Offer quality, lint, budget and history. | Trim a core line | Core 5,998 of 6,000 B |
| Sessions | The evidence behind signals and failures. | Open a failing session | Bash errors 1,116 of 47,710 (7 d) |
| Automation | Controls and rules only. | Grant, revoke | Automation rate 95% (1,297 of 1,363) |

Counter-numbers: "after" counts differ by kind. For CLAUDE.md lines they are misses. For checks they are likely catches (unverified, the gate is also the signal source).

## Data changes (one writer each)

1. `decidedBy`, `decidedAt` on the lesson. Writer: `approve` and `decline`, `corrections.ts:316,362`. Files: `corrections.ts`, `ui/api/proposals.ts:12,20`, `ask.ts`.
2. `landed {commit, at}` on the lesson. Writer: the land path, `jobs/lib/land/landing.ts` (body of `settleOnMain` not read). Today: derive by `git log --grep`.
3. Dedupe signals (1123 has 6 duplicates). Writer: `group`, `corrections.ts:191-196`. Bound decided lessons: keep `{at, source}` and the newest 20 quotes (PRINCIPLES.md rule 8).
4. `rule` and `path` on rule events. Writer: `logAlways`, `ask.ts:247`; Event type `lib/naming.ts:138`; schema `lib/db.ts:26`. Today rule acts map to a rule only by the text of `detail`.
5. `session` on each signal. Writer: the signal collectors in `corrections.ts` (`chrisSignals`, `gateSignals`). Unverified: whether a trace id gives the session id.

Derivable now: lessons, signals, advice, issue, commits, before/after, grant and revoke times, rule acts by reason (`ui/api/gates.ts:71-80`), the 7-day decided split.

## Not verified

- Session counts: the `/api/sessions` call timed out on Langfuse. The Sessions row uses tool totals only.
- The nav order in the mocks comes from each view's `group` and `order`, not from a browser.
- The 17 security-path lands (aleph-3313), the grant time for `proposal-claude-md:global`, and who approved five older lessons (see the lessons proposal).
- Minutes are estimates, not runs.
- The mocks use `needs()` from `memory-health.js` and the helpers in `html.js` with real data, but the tabs and Review layout are new markup.
