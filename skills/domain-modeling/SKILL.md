---
name: domain-modeling
description: >
  Domain model: change a project's glossary, entity model and decisions.
  Use when resolving a term, an entity's identity, states or owner, or a
  decision.
---

Adapted from Matt Pocock's `domain-modeling` skill (github.com/mattpocock/skills @4ae2317).

# Domain Modeling

Build and sharpen the project's domain model as you design. This is the active discipline: challenge terms, invent edge cases, and write the glossary, the model and the decisions down the moment they settle. Only reading the glossary is not this skill. This skill is for changing the model.

## Where things live

- **Glossary**: the first file that exists of `GLOSSARY.md`, `GLOSSARY-MAP.md`, `docs/naming.md`. Create `GLOSSARY.md` only when none exists. Layout and the multi-context map: [GLOSSARY-FORMAT.md](./GLOSSARY-FORMAT.md).
- **Model block**: next to a group of related terms in the glossary. Format: [GLOSSARY-FORMAT.md](./GLOSSARY-FORMAT.md).
- **Decisions**: vault notes of kind `decision`, written with `aleph memory write`. Format: [DECISION-FORMAT.md](./DECISION-FORMAT.md).

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the glossary, say so at once. "The glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When a term is vague or overloaded, propose one precise term. "You say 'account'. Do you mean the Customer or the User?"

### Discuss concrete scenarios

Stress-test each relationship with a specific edge case. Force the user to say where one concept ends and the next begins.

### Ask the model questions

For each entity under discussion, ask three questions:

1. **Identity**: what makes two of these the same one? What is its ID?
2. **Lifecycle**: what states does it have, and which moves between them are legal?
3. **Owner**: which one module or role writes it? Who reads it?

Then ask for the invariants (what is always true) and the relations (to which entities, one or many).

### Cross-reference with code

Check every answer against the code before you record it. Cite `path:line`. Surface each contradiction: "The code cancels whole Orders, but you said partial cancellation is possible. Which is right?"

Flag every place where the code has two answers:

- two writers for one entity
- two names for one thing
- one word with two meanings
- fields that drifted apart in name or type

### Update the glossary inline

When a term or a model fact settles, edit the glossary right then. Do not batch. Keep implementation detail out of definitions. The model block is the only place for code facts.

### Record decisions sparingly

Write a decision note only when all three are true:

1. **Hard to reverse**: changing your mind later costs a lot.
2. **Surprising without context**: a future reader will ask why.
3. **A real trade-off**: there were genuine alternatives.

If one is false, skip the note. A decision that replaces an older one sets `supersedes`. Link each term that came from a decision with `(decision: <Title>)`.

## Done when

Each step is done when its check passes:

- **Challenge**: every term that conflicts with the glossary has been named, and the user chose one meaning.
- **Sharpen**: every vague term has one canonical name, and the user agreed.
- **Scenarios**: every relationship under discussion has an edge case, and the user answered it.
- **Model questions**: every entity under discussion has an identity, a lifecycle and an owner answer from the user.
- **Cross-reference**: every claim about the system is checked against the code, and each contradiction and each two-answer case was shown to the user.
- **Update**: every resolved term is in the glossary before you reply to the next message.
- **Model block**: every entity discussed has all five lines. Each code fact cites a `path:line` that you read, and each unresolved two-answer case is marked `(conflict: ...)`.
- **Decisions**: each decision is a vault note that `aleph memory write` accepted (with `supersedes` set where it replaces one), or it fails one of the three tests and you can name which. Each term from a decision names the note's exact title.
