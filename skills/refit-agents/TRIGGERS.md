# Triggers lens

Does each description fire on its branches, and only there? A description is the pointer to its skill, subagent
or command. [writing-for-agents](../writing-for-agents/SKILL.md) has the rules for pointers; this lens applies them
across all descriptions at once.

## Signals

- **Overlap.** Two descriptions name the same trigger ("review", "clean up", "debug") with no `NOT for:` to split
  them. List every trigger phrase across the descriptions and sort it; a phrase under two names is a candidate.
- **A missing branch.** The body handles a case (a mode, a file kind) the description does not name.
- **A buried lead.** The description opens with history or identity, not what the skill does. The listing cuts
  long descriptions from the end.
- **First or second person** ("I help", "you can"), where the spec asks for the third.
- **A dead pointer.** A memory line or skill that names a skill, file or command that does not exist.

## Proof

For overlap, write the prompt that both descriptions match, and say which one should win. For a missing branch,
cite the body's line. For a dead pointer, the lookup fails.

## Fix

Sharpen the wording first: front-load the leading word, one trigger per branch, `NOT for: <case> (use <other>)`
on both sides of an overlap. Merge two skills only when no prompt picks one over the other.

## Hold

Model: `check`. A routing eval (`claude plugin eval` with a tool-called grader on the skill) holds a trigger that
came back.

## Check

Which existing description would the new one's triggers also match? Search the descriptions for each trigger
phrase; record the hits.
