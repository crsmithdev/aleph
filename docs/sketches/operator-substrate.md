# Operator substrate

## Thesis

Construct is a personal substrate for operators of AI fleets — a deliberate
capture–organize–load layer that respects bounded human attention, built on
Claude Code's primitives.

Positioning:
- vs. memory tools (OpenMemory, Supermemory) — deliberate substrate, not
  passive memory.
- vs. task trackers (Tasks, Dispatch, claude-queue) — workbench, not queue.
- vs. notes apps (Tana, Reflect) — operator infrastructure, not journaling.

Audience: primarily AI-infra (Anthropic/Cursor/Continue/Sourcegraph-shaped),
secondarily design/founder. Optimize for engineering quality and simple,
focused UX. Construct itself is the showcase project; this is its marquee
feature.

## Two capture types, one pipe

| Type | Shape | Optimization target | Mental model |
|---|---|---|---|
| **A — fixes / adjustments** | Short, imperative, names files | Organization. Bucket by feature/area, dispatch a coherent batch in parallel. | Git-staging-area + "fire group" |
| **B — bigger / speculative** | Paragraphic, exploratory, "what if" | My refinement time on it. Pre-do the legwork so the conversation when we resume is fast — or arrive at "not worth it" without me. | Loop-engine branching + synthesis |

A is **grouping, not scheduling.** No auto-dispatch. Captures wait to be
grouped; dispatch is a deliberate per-group act.

B is **pre-refinement.** Branch on the 2–4 most likely sub-questions in
parallel, synthesize a verdict, resume with the legwork done.

## Three primitives, in order

1. **Capture** — any device, any AI, any modality, lands in one inbox.
2. **Organize** — triage classifies and tags; A items group by area; B items
   may enter a branching loop.
3. **Load** — at session start (or on demand), surface reference items
   relevant to the current worktree/area/files. *No more pointing me at a
   file.*

The earlier scheduler/dispatcher framing was missing (3). The note/context
distinction is artificial — one store, two retrieval modes.

## Capture ingress (multi-surface)

| Surface | Mechanism |
|---|---|
| CLI | `construct cap "..."` alias |
| Global hotkey | Raycast / AHK / hammerspoon → `cap` |
| Browser bookmarklet | Capture URL + selection + current AI chat |
| VS Code | `Construct: Capture` command palette |
| vibe-annotate | Annotations land in the inbox as `source: vibe-annotate` |
| iOS Shortcut | Voice memo → Apple transcription → POST to endpoint |
| Email | Forward to a private alias → SMTP webhook → POST |
| MCP write | `capture(line, source)` exposed as MCP tool — any MCP client (Claude Desktop, Cursor, Cline, ChatGPT Dev Mode) can call from a chat |
| HTTPS endpoint | Universal fallback; curl-able by any AI with web |

All land as one append to `inbox.md` with `{source, captured_at, raw}`.

## Triage (one Sonnet call per capture)

Outputs three classifications:

- `type: A | B | quick`
- `area: <feature/module/path tag>` (A items: required; B items: optional)
- `useful_as: act | reference | both` — drives whether the item enters the
  dispatch pipeline, the context-load pipeline, or both

Plus, for A:
- `files: <verified by grep>`
- `est_steering: low | med | high`
- `draft_prompt: <ready-to-dispatch>`

Plus, for B:
- `subtype: branchable | conversational | quick | strategic`
- For branchable: `branches: [{sub-question, budget_share}]`
- `approach: search | research | branch-loop`

Hold this with `eval-harness` against a held-out set so classification
accuracy is measurable and non-regressing.

## A — grouping workbench

- Browse view groups A items by `area` (5 in `src/research/`, 3 in sidebar, …).
- `construct fire <group>` opens one coordinated session that takes the
  group's items as a batch and fans out via Agent Teams / Dispatch / parallel
  subagents.
- Group reports back as one unit (PR per item, or one PR per group with
  per-item commits — TBD).
- Ungrouped items stay in the inbox; no pressure to drain.
- Implicit grouping signals to add over time: current worktree branch,
  recently touched files, what was on screen at capture time.

## B — pre-refinement via loop-engine branching

`branch` template on the existing loop engine (`src/research/src/loop/`). Maps
to the four-hook contract:

- **`processor`** — Cycle 0: branch list. Cycle N: research the assigned
  branch (inline, or recursively dispatch a `research` loop). Final cycle:
  synthesize verdict + trade-off table + abandon rationale.
- **`derivation`** — After cycle 0: spawn K branch cycles. After all branches
  finalize: spawn synthesis cycle. After synthesis: done.
- **`renderer`** — original capture, branch tree, per-branch finding,
  verdict, sources. Cross-artifact composition.
- **`stop_rule`** — synthesis artifact present (function of artifacts, not
  LLM judgment).

Engine extensions needed (small, not a rewrite):

1. **`depends_on: ArtifactId[]`** on Cycle — so synthesis waits on all
   branch artifacts before dispatch.
2. **Optional `parent_loop_id`** — if branches spawn child `research` loops
   rather than inlining.
3. **Cross-artifact renderer** — combine artifacts across child cycles
   (and possibly across child loops).

Three terminal verbs for B outcomes:

- `construct abandon <id> "<rationale>"` — records the kill reason inline.
- `construct promote <id>` — emits one or more A items into the inbox,
  already classified and area-tagged.
- `construct plan <id>` — scaffolds `docs/plans/<file>.md` for multi-step
  work.

Abandon is a first-class outcome. The decision log emerges from the inbox
itself.

## Load — session-start context loader

Hook on session/worktree start:

1. Read inbox.
2. Filter by current worktree's area / branch / recently touched files.
3. Surface reference items (those with `useful_as: reference | both`).
4. Offer "load these as context?" — one-key accept/skip.

This is the property that makes the substrate feel different from a queue.
"You just know" instead of "let me point you at a file."

## Build order (~3–4 weeks focused)

1. **Capture ingress** — HTTPS endpoint + MCP write + iOS Shortcut +
   bookmarklet. ~2–3 days.
2. **Triage with three classifications** — one Sonnet call; eval-harness
   covers accuracy. ~1–2 days.
3. **A grouping workbench** — area-grouped browse + batch dispatch verb on
   top of existing Dispatch/Agent Teams. ~3–4 days including UI.
4. **Session-start context loader** — hook that reads inbox, filters,
   surfaces reference items. *This is the demo moment.* ~2 days.
5. **B branching template + three loop-engine extensions.** ~1 week
   including tests on the existing harness.
6. **`promote` / `abandon` / `plan` verbs.** ~1 day.
7. **Polish, README articulating the thesis, 90-second video, public
   deploy story.** ~1 week.

## Quality bar (falsifiable)

1. Thesis in one sentence on the README; the code defends it.
2. Sub-second capture latency from every surface, measured and shown.
3. Triage classification accuracy held against a held-out set via
   `eval-harness`.
4. No silent failures anywhere — every error path produces an observable
   signal.
5. Lifecycle visibility — every captured item's state
   (`captured → enriched → grouped → dispatched → completed | abandoned`)
   rendered in UI with full source/decision history.
6. At least one real B-loop dogfood: a captured "should I build X" went
   through branching, produced a verdict, killed or shipped the suggested
   follow-up.
7. Multi-surface capture demonstrated end-to-end: captured from phone,
   processed locally, dispatched against a worktree, PR opened.
8. 90-second demo video, no narration.

## Dogfood gate (do before committing the engine extensions)

Pick a real B item. Walk it through the branching pattern manually in a
thread the way the inbox-vs-PrivateBin and cross-AI-share critiques were
done. If the manual synthesis matches what the conversation produced, the
pattern earns the engine work. If the conversation produced something the
synthesis couldn't, add a `human_drill_into_branch` hook to the template
before shipping.

## Open questions

1. Does `act | reference | both` collapse to two states once we use it?
   (Likely `act-then-archive` for most A items, `reference` permanently for
   plan-shaped docs.)
2. Does the session-start loader want a confidence threshold to suppress
   noisy surfaces?
3. Group-level dispatch shape: one PR per item, or one PR per group? Probably
   per-item with a group label.
4. How aggressively does the inbox auto-archive vs. keep forever? Default:
   never auto-archive; explicit `archive` verb.
5. Voice-from-phone — Apple transcription only (v1), or Whisper endpoint for
   higher accuracy (v2)?
6. Construct-vs-separate-tool question stays deferred (user's call later).

## Prior art (must not reinvent)

- Claude Code Tasks / Dispatch / Agent Teams — execution primitives; this
  is the workbench on top.
- OpenMemory MCP, Supermemory MCP — passive memory; this is deliberate.
- Tana, Reflect, Mem — notes; this is operator infra.
- claude-queue, qlaude — queue with priorities; this adds grouping +
  branching + reference loading.
- PrivateBin + plain URL — cross-AI share substrate; orthogonal, not
  competing.
- Construct's own research engine — substrate for B branching, with three
  small extensions.
