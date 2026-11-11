# Interface lens

Can an agent build, test, run and use the repo with no one to ask? An agent learns a repo from what it can run
and read. Every lookup it has to guess, and every command that asks a question or hangs, costs a turn or a wrong
action.

## Signals

- **One command each** to install, build, test, lint and run, in the manifest (`package.json` scripts, a
  Makefile, a justfile) and named once in the README or memory file.
- **CLI usage.** For each CLI and subcommand: is there a usage line in the code? Read the source for how `--help`
  and `-h` are handled before you run anything. A subcommand that ignores `--help` and runs is a finding.
- **Errors that teach.** A wrong call names the right usage, not a stack trace or "invalid arguments".
- **Interactive commands.** A prompt, a pager, an editor, a browser opened, or a watch mode as the default.
  Each needs a flag or a variable that turns it off (`--yes`, `--json`, `CI=1`).
- **Machine-readable output.** A command an agent reads back has `--json` or a stable line format.
- **Tests.** One test file runs on its own; the suite is fast enough to run after each change; no flaky test
  without a record.
- **Setup.** A fresh clone gets to a green test run with the documented commands and no hidden step (an env
  file, a service, a global tool). `.env.example` lists every variable the code reads.
- **Memory file** (`CLAUDE.md` or `AGENTS.md`) at the root, short, pointing at the commands, not copying them.

Factory's agent readiness levels give a fuller rubric (style and validation, build, testing, documentation, dev
environment, observability, security, task discovery); use it for scope, not as proof.

## Proof

Run it from a clean state, or trace it in the source: the command fails, asks, hangs, or has no usage; the setup
needs a step no file names. Cite the line or the output.

## Fix

Put the knowledge in the code: a usage table the CLI prints and a help path that runs nothing, usage in each
refusal, a non-interactive flag, a manifest script. Then point the memory file at it and delete the prose copy.

## Hold

A test that runs `<cli> <cmd> --help` for each command and asserts it prints usage and changes nothing; a CI job
from a fresh clone.

## Check

Can an agent find and run the new command, flag or step without reading its source? Name where its usage lives.
