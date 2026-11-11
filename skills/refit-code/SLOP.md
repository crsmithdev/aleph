# Slop lens

PRINCIPLES rule 11: a line that serves a case that cannot happen goes. Slop is code that runs but is bigger
than its job, the shape AI-written code takes: defence for impossible states, hidden failures, narration.
`identity/STYLE.md` has the rules the code should meet (rules 10 and 12 in particular).

## Signals

- **Defence for impossible states.** A fallback (`??`, `||`, default parameter) on a value the types or the
  callers always set; a `try` around code that cannot throw; input checks inside the boundary, not at it;
  retries on local calls.
- **Swallowed failures.** An empty `catch`, a `catch` that returns null, `[]`, `""` or false, `.catch(() =>
  ...)`. These also break PRINCIPLES rule 3: the failure is no longer visible.
- **Type escapes.** `as any`, `: any`, an assertion the types already prove.
- **Options nobody passes.** A parameter, flag or config key with one value at every caller.
- **Narration.** A comment that says what the next line does, a banner comment, a doc comment that repeats the
  signature.
- **Leftovers.** A compatibility re-export, a "legacy" branch, a debug log, a wrapper kept for later.

Count the patterns with `grep` over the scope, excluding tests; counts are signals, not findings.

## Proof

The removal gate. Remove a line only when at least one holds:

- the case it handles is ruled out by the types, by validation at the boundary, or by every caller;
- it duplicates behaviour that exists;
- it narrates code that says the same thing;
- it hides a type problem (`any`, a broad `catch`);
- it adds logging, a retry, config or an option that no caller, failure mode or test needs.

Keep it when a test, a real input or an external caller reaches it, or when it guards a boundary (user input,
a file, the network, another process). Trace the callers and the types; cite them.

## Fix

Delete or shrink the line, on lines the branch owns. Lines outside the branch are reported, not edited.

## Hold

typescript-eslint `no-unnecessary-condition` and `no-unnecessary-type-assertion` for impossible fallbacks and
needless casts; a shrink-only ratchet for empty or swallowing `catch` and `any`. Not wired yet: the holds table
lists them as unchecked.

## Check

Does each new guard, fallback, option and comment have a case that reaches it? Name the case or cut the line.
