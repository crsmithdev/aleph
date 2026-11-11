# Copies lens

Is each topic said in one place? Two copies of one fact drift apart, and then one of them is a **true** finding.
This lens owns doc copies; refit-code's one-way lens points here.

## Signals

- **One topic in two docs:** the same install steps, the same table of options, the same explanation.
- **A doc that restates code:** a list of flags, a config schema, a type, a usage block copied from the source.
- **jscpd** over the docs (`npx jscpd --format markdown docs README.md`) finds copied blocks.
- **Repetition that helps** a reader is allowed (Write the Docs ARID): a short reminder with a link to the owner
  is not a copy.

## Proof

Quote both copies and say which one is the owner. When they already disagree, it is also a **true** finding.

## Fix

Keep the owner, which is the code when the code says it. Replace each other copy with a link or one line and a
link. Generate a copied block from its source (`cog`, `embedme`) when the reader must see it in place.

## Hold

jscpd over the docs in a test; model: `check`.

## Check

Does the new section say something another doc or the code already says? Link to it.
