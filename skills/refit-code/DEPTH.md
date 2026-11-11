# Depth lens

A module is **deep** when a lot of behaviour sits behind a small interface, and **shallow** when the interface
is nearly as complex as the implementation (`aleph:codebase-design`). A shallow module spends the caller's
attention and gives back little; its logic leaks into the callers that work around it.

## Signals

- **Wide interface, thin body.** Many exports or parameters, each doing little; callers must learn the order,
  the invariants or the configuration to use it.
- **Pass-throughs.** A function or module whose body forwards to another with the same arguments.
- **Callers assemble one decision by hand.** Three callers each combine the same small parts (read a record,
  check two gates, pick a tier) instead of asking one module for the answer.
- **Bouncing.** Understanding one concept means reading many small modules in turn.
- **No locality.** Pure functions were pulled out for tests, but the bugs live in how callers combine them.
- **Hard to test through the interface.** A test reaches past the interface, or mocks the module's own parts.
- **Hot spots.** The seed's most-fixed files: friction concentrates where a module is the wrong shape.

## Proof

Apply the **deletion test**: picture the module deleted. If its complexity vanishes, it was a pass-through; if
it reappears across N callers, it earns its keep. A finding names the result and the callers that would absorb
or rebuild the logic, with `file:line`. With no clear result, rate it 1-5.

## Fix

Inline a pass-through into its caller. Deepen a shallow cluster: one module with a small interface that hides
what the callers assembled by hand. A fix that needs a new interface follows [DEEPEN.md](DEEPEN.md), which designs it with
the user before code.

## Hold

Mostly judgment. `check` asks the deletion test of every new module. A lint for one-line pass-through functions
is the only tool hold, and it is not wired.

## Check

Would the new module pass the deletion test? Does its seam have a second adapter (production and test), or is
it a hypothetical seam? Does an existing module do most of the job, so the change deepens it instead?
