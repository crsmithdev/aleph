# Research engine — refocus thoughts

The current engine is built for "research that runs for days or weeks." Most realistic single-query topics top out at ~80% of their possible quality after 30 minutes of work; the long-horizon framing genuinely pays off only in three narrow cases. This doc sketches what the architecture could look like if we accepted that and refocused on the **30-min-to-overnight** band as the primary use case.

Not a decision — a thinking artifact to react to.

## Where the long-horizon framing actually wins

Real cases for days-to-weeks:

1. **The world is still happening.** Court cases unfolding, regulatory comment periods, security disclosure timelines, conflict reporting, scientific disputes with response papers landing. A 1-hour run gets a snapshot; a 14-day run gets the *story*.
2. **Latency-bound sources.** FOIA responses, preprint drops, embargo lifts, conference proceedings, expert outreach replies, government data releases. Real wall-clock waiting between leads — not compute time.
3. **Breadth × depth that doesn't fit in hours.** Real corpora that take a long time to actually read, not just retrieve. "Every clinical trial for X with full protocol/result analysis." "Every Senate vote on Y back to 1970 with cosponsor networks."
4. **Accumulating personal knowledge bases.** Writing a book / building a thesis / running competitive intel. Findings pile up across many sessions on a long-lived topic.

In practice this almost never looks like *one query running for 7 days*. It looks like:

- **Monitor mode** — saved query runs daily/weekly, accumulates a changelog of what's new. Construct already has this surface.
- **Patient mode** — fire and forget overnight. Not because the work needs 48 hours of compute, but because the user is happy to wake up to a richer artifact.

So the long-horizon story is really *Monitors + accumulating-knowledge-base* sitting on top of a great single-run engine — not the engine itself needing to span days.

## What could be deleted if we accept this

1. **Durable, multi-session, restart-safe job dispatcher.** The DB-backed job table, claim/reclaim, heartbeat, rate-limit-survives-restart machinery exists because "this might run for a week through 3 process restarts." Bounded sessions (≤12 h) make an in-process Promise tree with timeouts sufficient. Lose: cross-restart resume, cross-session priority arbitration. Shed: a *lot* of state-machine complexity.
2. **Cross-session worker pool.** The pool exists to share scarce concurrency across many concurrent multi-day sessions. Bounded sessions × modest concurrency → each session can own its own async fanout. WorkersPage stops being primary navigation.
3. **Perturbations / re-review / post-mortems as engine features.** They compensate for "we ran a long time and drifted." Bounded runs let the user just look at the artifact and re-run with a tweaked prompt — cheaper and clearer than auto-self-correction.
4. **Monitors as a core engine concept.** Pull them out into a separate product that takes a saved query, runs it on cron, diffs results. The long-horizon story lives there instead of contaminating the single-run engine.
5. **Multiple job modes (priority/default).** With one bounded use case, one mode.

## What could be made better

1. **Budget envelope as the contract.** Current parameters are intermediate (depth × min-searches × max-iterations). Replace with a single user-facing knob: "60 min" / "$5" / "by 8 am." Engine plans backwards from that envelope. Probably the single biggest quality win — a planner with a known ceiling makes very different decisions than a steered agent that just keeps going.
2. **Front-load planning.** Spend 10–15 % of budget on a deep plan, then execute it. The current engine sounds more like "agent loop with corrections" — that pays off over many hours but underperforms a structured plan-then-execute template at the 30-min-to-overnight scale.
3. **Pre-flight clarification, not mid-flight.** A bounded run can afford 1–2 questions to the user *before* the run starts (with a timeout so it proceeds if the user is asleep). It cannot afford to stop mid-run waiting for input. Replaces a lot of role-priming / shape-detection that's compensating for ambiguous prompts.
4. **Artifact-shaped output, not stream-shaped.** For overnight, the user wakes up and *reads*. The deliverable should be a finished report — sections, citations, explicit gaps, "what I couldn't answer and why" — not a tab full of fragments to assemble. Telemetry and event stream stay, but as a debugging surface, not the primary output.
5. **Milestones inside the run.** At 25 / 50 / 75 % of budget, post a "here's what we know so far" summary. Cheap to add, makes watching much better, and gives the user an early-exit option if the answer is already there.

## One-line shape

> Replace the durable multi-session job machine with an in-process budget-bounded Promise tree. Move monitors out. Make the artifact a finished report, not a stream.

## What survives unchanged

Findings / extraction / citations, telemetry, multi-provider abstraction, Jina search, the UI primitives (StatCard, DataTable, ChartContainer). The simplification is mostly in the engine layer, not the data or display.

## Risk

The current architecture *is* over-engineered for the bounded case but it's also load-bearing for the monitor case. If monitors are valuable, splitting them cleanly is a real refactor — not free. There's also accumulated tacit knowledge in the dispatcher (rate-limit handling, fan-out tuning, extraction queue back-pressure) that would need to be preserved or rebuilt in any replacement.

## Cheapest path to test the thesis

Don't delete anything yet. Add a new **bounded-run mode** alongside the existing engine:

- New entry point that takes a budget envelope and runs end-to-end in-process (no dispatcher, no workers, no job table)
- Plans up front, executes a flat fanout, synthesizes a report at the end
- Posts milestone summaries at budget checkpoints
- Writes findings to the same store the existing engine uses

Run both modes side by side for a few weeks on real questions. If bounded mode produces equal-or-better artifacts at the 30-min-to-overnight band, *then* delete the dispatcher / worker pool / multi-mode machinery and split monitors into their own product. If it doesn't, the existing architecture earned its keep.

## Open questions to react to

- Is the **monitor** use case important enough to keep first-class, or is it niche enough to defer / drop?
- For users who *do* want long single-query runs, does the bounded-run mode just expose a higher budget ceiling, or do they need the durable resume semantics of the current engine?
- Is there any value in **multi-session priority arbitration** that would be lost by per-session-owned concurrency? (e.g. when 5 sessions run simultaneously, the dispatcher arbitrates fairness — does that matter?)
- How much of the current Reviews / post-mortem surface is the user using? If it's load-bearing for trust ("I can see what went wrong"), it should survive in some form even if perturbations are dropped.
