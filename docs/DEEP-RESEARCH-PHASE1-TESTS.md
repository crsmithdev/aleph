Execution loop resilience:

Mid-iteration API failure (web_search returns error on step 4 of 15) — does the engine log the failure, skip that thread, and continue to the next one without losing prior findings from that iteration?
Budget exhaustion mid-iteration — step 5 of an iteration pushes cumulative cost past budget_daily_usd. Does the engine finish storing the current finding before pausing, or does it drop data?
Session started with a query that returns zero useful search results ("research qwxzpt") — does it handle empty/garbage results gracefully, mark the thread exhausted quickly, and not spin?

Perturbation correctness:

Perturbation at depth 0 (root thread) — does the analogical/contrarian/etc. strategy produce a meaningful tangent when the only context is the seed query, with no prior findings to work from?
Perturbation chain continuation — a perturbation thread spawns, gets 1 finding, then that finding spawns a follow-up thread. Verify the grandchild thread has origin: "follow_up" (not "perturbation") and its parent_thread_id points to the perturbation thread, not the original.
All 4 Phase 1 strategies (analogical, contrarian, failure post-mortem, temporal shift) produce meaningfully different tangent queries for the same input topic. Not just rephrased versions of each other.

Plan and steering:

Veto the only remaining queued thread — what happens on next iteration? Does the engine correctly see nothing to work on and either spawn perturbation threads or flag in the plan?
Boost a thread that's already exhausted — should this reopen it (reset status to "active", increment max_depth) or reject the action?
Rapid sequential steering — veto item 3, then boost item 3 before the next iteration runs. Last-write-wins? Error?


Thread lifecycle:

A thread that produces one excellent finding (novelty 0.9) then three duds (novelty < 0.3) — does it correctly exhaust after the 3 low-novelty findings even though the first was great?
Deep thread at max_depth spawns follow-up questions — verify the child threads are NOT created (respects the ceiling) and the follow-up questions are stored on the finding record for reference.
Deduplication across threads — thread A finds "Josephine County has no building permits required for structures under 200 sqft" and thread B later finds essentially the same fact from a different source. Verify the second is flagged as duplicate or related, not stored as a novel finding.

Cost tracking accuracy:

Run 10 iterations, sum up cost_usd across all research steps, compare against the Anthropic API usage dashboard. They should match within a reasonable tolerance (token counting rounding).
Plan estimated costs vs. actual costs — after a planned window runs, compare the plan's estimated_cost per item against the actual step costs for those threads. Useful for calibrating future estimates.

Data integrity:

Kill the process (SIGKILL, not SIGTERM) mid-iteration. Restart. Verify: no corrupted records in SQLite, the partially-completed iteration's step either committed fully or not at all, the engine resumes from the right place.
Session with 500+ findings — verify the rolling summary actually updates and doesn't just grow unboundedly or start hallucinating from context overflow.

The "does it actually research well" test:

Start a session on a topic you know well (e.g., "CDJ-3000 vs SC6000 comparison for EDM DJs"). Run 10 iterations. Manually evaluate: are the findings factually accurate? Are the follow-up questions sensible? Does at least one perturbation thread surface something you wouldn't have searched for? This is qualitative but it's the test that actually matters for Phase 1 — the system has to produce useful output, not just mechanically correct output.