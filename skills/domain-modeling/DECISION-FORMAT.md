# Decision Format

A decision is a vault note of kind `decision`. Write it with `aleph memory write`, as `skills/vault/SKILL.md` ("write") describes. Do not create `docs/adr/` files.

## Note

1. Draft `<Title>.md` in the scratchpad. The title is Title Case, unique, and names the decision ("Events Live In One Daily File").
2. Set `kind: decision`, `scope: <repo name, or global>`, and `sources` to the files, traces or people that back it.
3. Write the body: `**Claim.** <what we decided and why, in one or two sentences>, as of <date>.` Add `## Details`, `## Evidence` and `## Related` only when they add value. Add `Considered options` under Details only when a rejected option is worth remembering.
4. Run `aleph memory write "<path>" --why "<one line>"`. If it refuses, fix the draft and rerun.

If the decision replaces an older note, list that note's title in `supersedes`. Never write a second note about the same thing.

Set `core:` only when every session in the scope needs the decision before it starts. The core budget is small.

## When a decision earns a note

All three must be true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful.
2. **Surprising without context**: a future reader will wonder why it was done this way.
3. **A real trade-off**: there were genuine alternatives and you picked one for specific reasons.

If one is false, write no note. An easy decision is just reversed. An unsurprising one needs no reason. With no alternative, there is nothing to record.

### What qualifies

- **Architectural shape.** "The write model is event-sourced and the read model is projected into Postgres."
- **Integration between contexts.** "Ordering and Billing communicate by domain events, not synchronous HTTP."
- **Technology with lock-in.** A database, message bus or auth provider. Not every library.
- **Boundary and scope.** "Customer data belongs to the Customer context. Other contexts hold its ID only." The explicit no is as valuable as the yes.
- **Deliberate deviation.** "We use manual SQL instead of an ORM because X." This stops the next person from "fixing" it.
- **Constraints the code does not show.** "No AWS, because of compliance." "Under 200 ms, because of the partner contract."
- **Non-obvious rejections.** If you rejected GraphQL for subtle reasons, record it.

## Link from the glossary

A glossary term that came from a decision ends its definition with `(decision: <Title>)`, where `<Title>` is the note's exact title. Write one parenthetical per note. Before you write the link, run `aleph memory recall "<Title>"` and confirm the note exists.
