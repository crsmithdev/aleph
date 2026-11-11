# Seams lens

A **seam** is where a module's interface lives (`aleph:codebase-design`). Code that reaches past it couples
itself to the module's implementation: a change behind the seam breaks callers it should not reach.

## Signals

- **Raw reads outside the owner.** A record's fields, a file's frontmatter, a config's keys read directly in
  many places when one module owns that record.
- **Imports of internals.** An import of a module's private file instead of its entry point.
- **Wrong-way dependencies.** Domain code importing UI or infrastructure; a library importing its caller.
- **Tests past the interface.** A test that sets up or asserts on a module's internals.
- **One-adapter seams.** An interface, port or injection point with one implementation and no test adapter:
  indirection with nothing varying across it.
- **Dependency kind.** Sort each dependency: in-process, local-substitutable, remote but owned (ports and
  adapters), true external (mock). See `aleph:codebase-design` DEEPENING.md.

## Proof

Name each crossing read or import with `file:line`, and the owner it bypasses. A count of crossings is a
finding when the owner exists or one module is the clear home; with no owner yet, it is a depth finding.

## Fix

Route the access through the owner's interface; add the accessor the callers need there. Delete a one-adapter
seam, or give it its second adapter when a test needs one.

## Hold

A dependency-cruiser rule: only the owner reads the field or imports the internal file, or imports go only
through entry points. Not wired yet: the holds table lists it as unchecked.

## Check

Does the change read a record, file or module past its owner's interface? Does it add a seam with one adapter?
