# Rot lens

Does each doc still earn its place? A doc for a feature that is gone, a plan presented as current, or a dated line
reads as true until a reader trips on it.

## Signals

- **Dated text:** "currently", "as of", "recently", "new", a date, a version in prose:
  `grep -rnEi '\b(currently|as of|recently|for now|at the moment)\b|\b20[0-9]{2}-[0-9]{2}-[0-9]{2}\b' README.md docs`.
- **A doc for something removed:** its feature, command or module is not in the tree, nor in `HEAD`.
- **Records in the live docs:** a spec, a plan, a findings file, a meeting note outside a records directory, read
  as the current design.
- **Labels:** "experimental", "beta", "planned", "coming soon" on something that shipped or was dropped.
- **Changelog:** a release with no entry; entries that stop.
- **Contributing to docs:** no line that says how to report a doc issue or change a doc.

## Proof

The feature is not in the tree; the label disagrees with the code or the changelog; the date or "currently" is
older than the change that made the line wrong.

## Fix

Delete the doc, or move a record into the records directory (`docs/specs/`, `docs/adr/`). Remove a stale label.
Rewrite a dated line without the date, or delete it.

## Hold

Model: `check`.

## Check

Does the new line say "now", "new" or a date? Write it so it stays true, or put it in the changelog.
