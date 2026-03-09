---
name: spec
description: "Manage spec.md ↔ disk update. Subcommands: diff (read-only check), update (update spec from disk), apply (update disk from spec)."
argument-hint: "diff | update | apply"
---

Manage the relationship between `spec.md` and the installed Construct files.

## Subcommands

Route on `$ARGUMENTS`:

### `diff` (default if no argument given)

Read-only. Compare spec code blocks against files on disk. Report drift without changing anything.

1. **Parse** — Read `spec.md`. Extract every inline code block and its target file path from section headers.
2. **Diff** — For each file, compare spec content against disk content. Also detect files on disk not in spec, and spec entries with no file on disk.
3. **Report** — Show a summary table:
   ```
   | File | Status |
   |------|--------|
   | construct/core/hooks/statusline.sh | ✓ matches |
   | construct/memory/hooks/session-start.sh | ✗ drift — [1-line description] |
   | construct/dev/hooks/newfile.sh | ⚠ on disk, not in spec |
   | construct/meta/REMOVED.md | ⚠ in spec, not on disk |
   ```
4. **Summary** — Count: N match, N drifted, N missing. Exit with no changes.

### `update`

Update `spec.md` to match files on disk. Disk is truth.

1. Run `diff` first (show the report).
2. For each drifted file: update the spec's code block to match the file on disk.
3. For files on disk but not in spec: add them to the appropriate pack section.
4. For files in spec but not on disk: remove them from the spec.
5. Update file trees, install instructions, and verification scripts if the file set changed.
6. Confirm the spec's combined `settings.json` still matches `.claude/settings.json`.
7. Bump the version in the spec header and add a changelog entry.

Rules:
- Don't modify any Construct files — only `spec.md`.
- Preserve spec structure (pack order, section headings, changelog format).

### `apply`

Update files on disk to match `spec.md`. Spec is truth.

1. Run `diff` first (show the report).
2. Show what will change. Confirm before writing.
3. For each drifted or missing file:
   - Create parent directories if needed
   - Write the spec's code block content to the file path
   - Make `.sh` files executable
   - Write `settings.json` from the combined reference at the bottom of the spec
4. Run post-install verification for each pack that had files written.

Rules:
- Never modify `spec.md` — only write to `.claude/`.
- Always confirm before overwriting. No silent writes.
- Preserve local files not mentioned in the spec (don't delete unknown files).
- Skip user data (`MEMORY.md`, `CONTEXT.md`, `LEARNED.md`, `ratings.jsonl`, `sessions/` contents) — only write if they don't exist yet.
