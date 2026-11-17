# Drift lens

Does each agent file agree with the code and with the other agent files? An agent file that restates the
environment is a cache, and a cache goes stale. Agents follow a stale line as if it were true.

## Signals

- **Commands and flags.** Every command, subcommand and flag an agent file names. Resolve it against the CLI's
  own usage or source, not by running it: a command's `--help` may run the command.
- **Paths.** Every path and link: does it resolve? (agnix `REF-` covers imports and markdown links; backticked
  paths are yours.)
- **Usage copied into prose.** The grammar of a CLI written out in a memory file or skill. Right today, it is load.
  Wrong, it is drift. In both cases the CLI should own it.
- **Contradictions and dated text** ("as of", a version, a model name, "currently", a date) are
  [ADHERENCE.md](ADHERENCE.md) checks 1 and 16.
- **Built in.** `/doctor prompt-audit` in Claude Code finds stale and conflicting instructions and references to
  missing files or commands; ask the user to run it and read its report as candidates.

## Proof

The lookup fails (the path does not resolve, the flag is not in the source). Text that only reads dated is not proof.

## Fix

Make the code the source of truth and point at it. Correct or delete a wrong line. Replace a copied usage with a
pointer to the CLI's usage, after the CLI has one (an **interface** finding when it does not).

## Guard

See [Guards](SKILL.md#guards).

