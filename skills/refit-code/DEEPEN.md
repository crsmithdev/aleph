# Deepen

Adapted from the grilling loop of Matt Pocock's `improve-codebase-architecture` (github.com/mattpocock/skills
@4ae2317).

For one finding the user picked, usually a depth, seams or one-way finding whose fix needs a new interface. No
interface is proposed before this step.

1. **Grill.** Call the Skill tool with `aleph:grill-me` to walk the decision tree with the user: constraints,
   dependencies, the shape of the deepened module, what sits behind the seam, what tests survive. Done when
   each branch has a decision.
2. **Design it twice.** To compare interfaces, call the Skill tool with `aleph:codebase-design` and use its
   design-it-twice parallel subagent pattern. Done when the user picked one.
3. **Keep the domain model current**, as decisions land, through `aleph:domain-modeling`:
   - A deepened module named after a concept not in `GLOSSARY.md`: add the term. Create the file lazily.
   - A fuzzy term sharpened in the conversation: update `GLOSSARY.md` there and then.
   - The user rejects the finding with a load-bearing reason: offer an ADR, framed as "Want me to record this
     as an ADR so future reviews don't re-suggest it?" Only when a future reviewer would need the reason;
     skip ephemeral ones ("not worth it right now") and self-evident ones.
4. **Hand on.** The decided design goes to the build as a spec (`/aleph:to-spec`) or straight to `act` when it
   is small. Add its hold (one-way or seams) in the same change.

**ADR conflicts.** A finding that contradicts an ADR in `docs/adr/` is surfaced only when the friction is real
enough to reopen it, marked in the report ("contradicts ADR-0007, but worth reopening because ..."). Do not list
every refactor an ADR forbids.
