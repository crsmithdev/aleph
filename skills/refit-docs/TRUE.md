# True lens

Does each doc agree with the code? Incorrectness and obsoleteness are what developers rate as blockers (Uddin and
Robillard 2015), and up-to-dateness is the second most frequent doc issue (Aghajani et al. 2019). The code is the
truth; the doc is the copy.

## Signals

- **`refs.ts` broken list:** links, anchors and repo paths that do not resolve; env vars and own-CLI flags that no
  source file holds.
- **Commands.** Each command a doc shows: does it exist, and does its usage match? Read the CLI's source or usage
  table; run `--help` only where the source shows it runs nothing.
- **Examples.** Each code block a reader would run: does it run, and give the output the doc shows? Use the
  doc-test runner of [TOOLS.md](TOOLS.md), or run it in a scratch directory.
- **Copied snippets.** A block that copies source code: does it still match? (`cog --check`, `embedme --verify`.)
- **Claims.** A default, a limit, a behavior, a version the doc states: find the line of code that sets it.
- **In aleph,** `aleph doc-claims` checks the claims of `README.md` and `docs/`.

## Proof

The lookup fails, the example fails, or you can quote the doc and the line of code that disagree. Resolve the
reference rather than reading around it: a command that runs is current even where the prose around it reads dated.

## Fix

Correct the doc to the code, or delete the line. When the code is wrong and the doc is the intent, report it to the
user: that is a bug, not a doc fix.

## Hold

`refs.ts` broken list empty in a test; the doc-test runner in CI; `aleph doc-claims` in aleph.

## Check

Does each new doc line name a path, command, flag, default or behavior? Point at the line of code that backs it.
