# Code Conform — Full Dimension Taxonomy

The five axes the skill compares peers against. SKILL.md keeps the short list; this file is the deep reference, loaded only when the comparison needs more nuance.

## 1. Structural

- File/section ordering (imports → types → public API → helpers → exports).
- Function signatures: parameter order, optional vs required, default values, return types.
- Module shape: do peers export a class, a factory, a set of free functions?
- Section boundaries: is there a single `start()` method that wires listeners, or is wiring scattered?

Use this axis when peers are "the same kind of thing" with the same job (route handlers, providers, services).

## 2. Compositional

- Which helpers, wrappers, and primitives the file uses.
- Whether the file *should* delegate to a shared utility but reimplements it inline.
- Composition over inheritance: does each peer compose a `Db`, an `EventBus`, a `Logger`, a `RateLimiter` the same way?
- Constructor / factory shape: does the reference take dependencies as a config object, individual args, or a builder?

Use this axis when peers vary in *what they're built from* even though they do the same job.

## 3. Behavioral

- Error handling: throw vs return-empty vs return-error-tuple. **One shape per cluster of peers.**
- Validation: where does input parsing happen — at the boundary, deep inside, both?
- Response shape: do all peers return the same envelope `{ data, error, ... }`?
- Retry / fallback / timeout: does the reference back off and retry, and do peers do the same?
- Side effects: does the reference always emit an event for every mutation, and do peers?
- Idempotence: is the reference safe to call twice, and are peers?

Use this axis when peers' *observable behavior* drifts even though they look structurally similar.

## 4. Surface

- Imports: same source paths, same names, no aliasing drift.
- Type names: do peers use `LLMResult` or `ProviderResult` or `Response`?
- Naming conventions: `fmt*`, `parse*`, `compute*` prefixes used consistently?
- Comment style and placement.

Use this axis when peers behave correctly but read inconsistently.

## 5. Duplication of behavior across modules

**The consolidation axis. First-class — not a sub-bullet of the others.**

Symptom: the same problem is solved in N places. Either each place has its own inline implementation, or they each import a different helper that does the same thing.

How to spot it:

- `grep -rn "<distinctive snippet>" src/` finds matches in 3+ unrelated files.
- The reference is presented as "the helper that should exist" — not as a peer to align.
- Peers compute the same value, parse the same string, validate the same shape, format the same data.

Fix shape (consolidation, not propagation):

1. Confirm the canonical helper exists and is exported. If not, lift the cleanest inline copy out into a shared module first.
2. For each peer site: rewrite the inline code as a call to the helper. Update imports.
3. Remove the now-dead local implementation. If a peer had its own private helper, delete it.
4. Verify: `bun test.ts` should pass without changes — behavior is unchanged, only the source of the behavior moved.
5. Optional structural confirmation: `ast-grep --pattern '<inline shape>'` should now return zero hits outside the canonical helper.

Common forms:

- **Inline string parsing** — `name.slice(5).split('__')` repeated in 3 components, when one helper centralizes it.
- **Ad-hoc number formatting** — `${(n / 1000).toFixed(1)}K` scattered across pages, when `fmtNumber` exists.
- **Inline date formatting** — peers using `new Date(iso).toLocaleString()` instead of the project's `dateTime` helper.
- **Repeated validation** — peers each call `z.parse(schema)` inline when a shared validator exists.
- **Re-rolled error wrapping** — peers each `try { ... } catch (e) { return { error: e.message } }` instead of using a shared `wrapHandler`.

This axis is the most valuable one to enforce — it's where uncontrolled drift accumulates fastest as the codebase grows.

## Choosing dimensions for a session

Default: all five, biased toward whichever is most visibly broken in the peer list.

If the user's notes name a specific dimension ("error wrapping only"), restrict to that one and ignore the others — even if you spot drift on another axis. Surface the unrelated drift in the report ("seen but not fixed: peers also vary on response shape — re-run with `— response shape` to address") and stop.
