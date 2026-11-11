# Load lens

Does each always-loaded line earn its tokens? Every line of a memory file, every model-invoked description and
every line a hook injects costs on every turn, whether it fires or not.
[writing-for-agents](../writing-for-agents/SKILL.md) has the ladder (in-file, disclosed, environment) and the
words this lens uses: context load, cache, sprawl, sediment.

## Signals

From `load.ts`:

- **The always total**, and the five largest items. Claude Code warns past about 200 lines per memory file.
- **A model-invoked skill nobody reaches on its own.** It fires only by hand: `disable-model-invocation: true`
  drops its description from the load.
- **A long description.** Over 500 characters, or one that lists synonyms of one branch.
- **A long skill body.** Over 500 lines, or reference that only some branches need, still in `SKILL.md`.
- **Hook output.** Each event in `hooks` injects text; measure it from a session trace (Langfuse in aleph) or by
  running the hook with a sample input. A hook that prints the same block every turn is load.
- **A memory file that repeats another.** The same rule in `~/.claude/CLAUDE.md` and the repo's `CLAUDE.md`.

In a live session, `/skill-doctor` shows each skill's cost per turn and the skills a session never invoked, and
`/status` shows the memory files that are too long. Ask the user to run them; you cannot.

## Proof

A line is load when one holds:

- it is a **cache** of a lookup that costs one command or one file read (the agent can find it by looking);
- only some branches need it, and it is not behind a pointer;
- it says the same as another always-loaded line;
- it is a model-invoked description of a skill that nothing but the user invokes.

Keep it when the agent cannot find it by looking (a convention, a reason, a gotcha), or when every branch needs it.

## Fix

Move it down the ladder: to a linked file, to the skill body, to the environment (a usage line, a config), or set
`disable-model-invocation: true`. Delete it only when no branch needs it. Record the always total before and after.

## Hold

The `load.ts` always total as a shrink-only ratchet in a test: a change that raises it records the new total and
why.

## Check

Does the new line need to be loaded on every turn? Name the branch that needs it before the pointer fires, or put
it behind a pointer.
