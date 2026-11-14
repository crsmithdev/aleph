# Glossary Format

## Which file is the glossary

Use the first of these that exists:

1. `GLOSSARY.md`
2. `GLOSSARY-MAP.md` (multiple contexts, see below)
3. `docs/naming.md`

Edit that file in its own layout. In aleph it is `docs/naming.md`, a table of `Term | Definition`. Create `GLOSSARY.md` only when none of the three exists, and only when the first term is resolved.

## Terms

In a new `GLOSSARY.md`:

```md
# {Context Name}

{One or two sentences: what this context is and why it exists.}

## Language

**Order**:
{One or two sentences.}
_Avoid_: Purchase, transaction
```

In a table glossary, one row per term: `| Order | {definition} |`. Put the avoided words in the definition ("Not a purchase.") or in the doc's old-words line, as the doc already does.

Rules:

- **Be opinionated.** Pick one word per concept and list the others as avoided.
- **Keep definitions tight.** One or two sentences. Define what it is, not what it does.
- **Only project terms.** General programming concepts do not belong.
- **Group terms** under subheadings when clusters form.
- **No implementation detail** in a definition. The model block carries code facts.
- **Name the decision.** A term that came from a decision ends its definition with `(decision: <Title>)`. `<Title>` is the exact title of the vault note ([DECISION-FORMAT.md](./DECISION-FORMAT.md)). This works in a list, a table cell, or a table with a trailing `Decision` column if the doc already has one.

## Model block

Terms say what a word means. The model says how the thing behaves. Put one block directly after the terms of a group of related entities, under a line `**Model: {group}**`. In a table glossary, put it after that table.

```md
**Model: Job**
- **Job**
  - Identity: one attempt on a subject. ID `<subject>#<n>`, built at `lib/naming.ts:88`.
  - Lifecycle: queued, running, done, dropped. Legal moves: queued to running, running to done or dropped. `lib/jobs.ts:140`.
  - Owner: writer `factory/run.ts` only (`factory/run.ts:52`). Readers: UI, report.
  - Invariants: a done job has a cost. A subject has at most one running job. `lib/jobs.ts:171`.
  - Relations: belongs to one Subject. A Subject has many Jobs.
```

Rules:

- Write one entry per entity, with all five lines. Write "none" for an invariant list that is empty. Do not leave a line out.
- Cite `path:line` for every fact that comes from the code. Check the line before you write it.
- A fact the code does not show is a claim of intent. Mark it `(intended)` and ask the user to confirm it.
- Where the code gives two answers, do not pick one. Write `(conflict: <path:line> vs <path:line>)` and raise it with the user.
- Keep a state, a field or a rule only when a person could break it. Skip the rest.

## Single vs multi-context repos

**Single context:** one glossary file, as chosen above.

**Multiple contexts:** a `GLOSSARY-MAP.md` at the repo root lists the contexts, where they live and how they relate:

```md
# Glossary Map

## Contexts

- [Ordering](./src/ordering/GLOSSARY.md): receives and tracks customer orders
- [Billing](./src/billing/GLOSSARY.md): generates invoices and processes payments

## Relationships

- **Ordering to Billing**: Ordering emits `OrderPlaced`. Billing consumes it to create invoices.
- **Ordering and Billing**: share the types `CustomerId` and `Money`.
```

If `GLOSSARY-MAP.md` exists, read it to find the contexts, and infer which one the topic belongs to. If unclear, ask. Decisions are not per context. Set the vault note's `scope` to the repo.
