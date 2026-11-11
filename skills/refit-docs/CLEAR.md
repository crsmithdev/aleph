# Clear lens

Does each sentence have one reading? Ambiguity is the doc problem developers rated most severe (Uddin and
Robillard 2015). The page-level rules are [docs-writing](../docs-writing/SKILL.md)'s `voice-`, `clarity-` and
`code-` rules; load them by prefix. This lens adds no rules of its own.

## Signals

- **Two readings.** A pronoun with two referents, a "this" or "it" at the start of a paragraph, a scope that is
  not stated ("all", "the file").
- **Unstated conditions.** A step that works only on one platform, version or state, and does not say so.
- **Two names for one thing** on a page or across the docs; a term used before it is defined.
- **Unexplained examples.** A code block with no sentence that says what it shows (a blocker in Uddin and Robillard).
- **The repo's style.** The style guide the repo names (in aleph, ASD-STE100 per `CLAUDE.md`); Vale and cspell
  output from [TOOLS.md](TOOLS.md); AI tells for the [humanizer](../humanizer/SKILL.md).

## Proof

Write the two readings, or name the condition and the reader who fails on it. A tool hit is a candidate only.
A readability score is never proof.

## Fix

Rewrite the sentence with one reading, per the rule it breaks. Define the term once and use it every time.

## Hold

Model: `check`. Vale with the repo's style in CI, when the user picks it.

## Check

For each new sentence: can a reader take it two ways, and does it hold on every platform and version it claims?
