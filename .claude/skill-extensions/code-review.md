# Construct: code-review

## Scope

All `.ts` files under `src/` and the installer (`install.ts`, `test.ts`).

## Additional checks

### Hook integrity
- Every hook command in `dotclaude/settings.json` points to a file that exists
- Every hook handles malformed stdin (JSON parse → exit 1)
- Every hook uses `trace()` from `src/trace.ts`
- No hook writes to stdout unless it has a meaningful message

### Duplication guard
- Nothing in `.claude/` duplicates what's in `dotclaude/` (double-fire risk)
- CLAUDE.md rules exist in exactly one location per the ownership table

### Backwards-compat cruft
- Look for shims, wrappers, or fallbacks kept "for backwards compat" that nothing reads anymore
- Check for old file paths, renamed exports, deprecated aliases, or stale config keys
- If the only consumer was removed, the compat layer is dead — remove it

### Install roundtrip
- Run `bun install.ts` && `bun test.ts` after review
- Installed copies match sources byte-for-byte
