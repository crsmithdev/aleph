# Sketch: grounding-aware feedback signal

## Problem

The hallucination-then-correction pattern (assistant answers a code question
without reading the source → user follow-up exposes the gap) is already
captured by `feedback-capture-submit.ts` as a generic negative-polarity
signal. But the JSONL row doesn't record the two facts that distinguish
*ungrounded answer* from any other negative feedback:

1. Did the prior assistant turn make a claim about a specific code symbol?
2. Did it actually read the source (Read / Grep / Glob) before claiming?

Without those, the consolidator can't surface a rule like "ground claims
before answering" — the cluster is invisible.

## Change

Two new boolean fields on the feedback JSONL row, both derived from the
prior assistant turn already captured by `parseTranscript`.

### File: `src/memory/hooks/feedback-capture-submit.ts`

Add after the existing `priorTools` / `priorFiles` block (around line 74),
before the `entry` object literal:

```ts
// Did the prior turn ground claims in actual file reads?
const GROUNDING_TOOLS = new Set(["Read", "Grep", "Glob"]);
const priorHadReadOrGrep = priorTools.some(t => GROUNDING_TOOLS.has(t));

// Did the prior turn make a specific code claim?
// Heuristic: backtick-wrapped identifier-with-parens, file path with
// extension, or `path:line` reference. Tight on purpose — false negatives
// are fine, false positives would poison the consolidator's clusters.
const CODE_CLAIM_RE = /`[\w./-]+\.(ts|tsx|js|jsx|md|json|css|html)`|`\w+\(\)`|`[\w./-]+:\d+`/;
const priorClaimedSymbol = CODE_CLAIM_RE.test(priorText);
```

Then add to the `entry` object:

```ts
prior_had_read_or_grep: priorHadReadOrGrep,
prior_claimed_symbol: priorClaimedSymbol,
```

Total: ~8 added lines, no new dependencies, no new hook.

## Consolidator side

`src/memory/consolidator.ts` currently joins feedback with memory blindly.
Once the new fields are in the JSONL, two follow-ups become possible —
**deferred** until we have data to confirm the signal is real:

1. **Filter / weight**: when polarity === "negative" AND prior_claimed_symbol
   AND !prior_had_read_or_grep, treat as a high-signal "ungrounded answer"
   event for clustering.
2. **Synthesis prompt**: add an example to the LLM synthesis path showing
   what an ungrounded-answer rule looks like (e.g. "Read source before
   asserting symbol behavior").

Both can wait until the signal has been flowing for a week or two — premature
to wire the consolidator to a metric we haven't validated.

## Open questions (defer until data exists)

- **Regex tightness.** Is `\w+\(\)` too narrow (misses `someObject.method`)
  or too broad (catches casual mentions like `fetch()`)? Decide after
  looking at first ~50 captured rows.
- **Grounding tools.** Should `Bash` count when the command is a `grep` /
  `cat` / `rg`? Probably yes, but parsing Bash args adds complexity; start
  with the explicit-tool set and revisit if false-positive rate is high.
- **Same-turn rule.** Right now the check is "any Read/Grep in the prior
  assistant turn." If that turn used a subagent (Explore, Plan), the
  tool list belongs to the subagent transcript, not the main one — the
  signal will look ungrounded when it wasn't. Acceptable noise for v1.

## Path forward

1. Land the two-field patch.
2. Let it run for ~1 week, eyeball the JSONL for sanity.
3. Decide if the signal is strong enough to justify consolidator changes,
   the soft-inject Stop hook from the prior conversation, or both.

If after the data settles the loop *isn't* surfacing a usable rule on its
own, that's the trigger to build the Stop hook (see prior conversation:
`grounding-check-stop.ts`, soft-inject mode, regex-driven trigger,
cross-referenced against turn's Read/Grep targets).
