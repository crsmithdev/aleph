# Gaps lens

Is everything a user needs documented? Incompleteness is the most frequent doc issue (268 of 878, Aghajani et al.
2019) and a blocker (Uddin and Robillard 2015).

## Signals

- **`refs.ts` undocumented env vars:** each env var the code reads that no doc names.
- **CLI.** Each command and flag the CLI accepts: does a doc or the CLI's own usage text cover it? A CLI with no
  usage text is a [refit-agents](../refit-agents/SKILL.md) interface finding.
- **Config.** Each config key the code reads, with its default.
- **Public API.** Each exported symbol with no doc block (the coverage tool of [TOOLS.md](TOOLS.md)).
- **README.** It says what the project is, its status, how to install it and how to use it (Prana et al., "Categorizing
  the content of GitHub README files", 2018, found many READMEs without purpose or status).
- **Errors.** An error message a user sees with no doc of its cause or fix.
- **Preconditions.** A how-to that needs a service, a key or a version it does not name.
- **Reader questions.** Write 15 to 20 "How do I..." questions a user of this project asks (install, configure,
  the main tasks, errors, integration). Mark each answered (a doc answers it with a working example), partial, or
  unanswered. This finds gaps from the reader's side; `refs.ts` finds them from the code's side.

## Proof

Name the thing and show that no doc and no usage text covers it: the search and its zero hits. An internal env var
(a test switch, a debug flag) is dropped with the reason when no user sets it.

## Fix

Document it on the page whose reader needs it (the [docs-writing](../docs-writing/SKILL.md) type of that page), or
in the CLI's usage text, and point at that.

## Hold

`refs.ts` undocumented list as a shrink-only ratchet; the coverage tool with a floor.

## Check

Does the change add a command, flag, env var, config key or public symbol? Name the page or usage line that
documents it.
