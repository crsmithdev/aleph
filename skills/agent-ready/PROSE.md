# Prose lens

Does each instruction change behavior, and can the agent tell when a step is done? The rules are
[writing-for-agents](../writing-for-agents/SKILL.md): no-ops, negation, completion criteria, leading words,
co-location. This lens applies them to every agent file; it adds no rules of its own.

## Signals

- **No-ops.** "Be thorough", "write clean code", "think step by step": what the model does by default.
- **Negation alone.** A "don't" or "never" with no positive target (agnix `PE-006`, `CC-MEM-006` flag some).
- **A step with no completion criterion**, or one the agent cannot observe ("until it is clear").
- **Scattered rules.** One concept's rules under three headings.
- **Restated triads** that a leading word would replace.
- **Emphasis inflation.** IMPORTANT, MUST, CRITICAL on lines that are not guardrails; the strong words lose force.

## Proof

Say what the agent does differently with the line and without it. When you cannot, it is a no-op. For a missing
criterion, quote the step and name the observation that would end it.

## Fix

Delete the no-op sentence whole. Rewrite a negation as its positive target. Add the criterion. Gather scattered
rules under one heading.

## Hold

Model: `check`.

## Check

For each new sentence: what does the agent do differently because of it?
