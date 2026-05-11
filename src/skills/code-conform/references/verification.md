# Code Conform — Verification

After applying conform edits, gate on these checks before claiming done.

## Required gates

| Scope of edits | Required command |
|---|---|
| Backend logic / hooks / services / SDK | `bun test.ts` from repo root |
| Typed frontend code (`src/ui/web/src/**`) | `bun run --cwd src/ui build` |
| Both | run both |

`bun test.ts` is the source of truth for backend behavior. CI runs the same command on every push (per `.claude/CLAUDE.md`).

## Optional structural confirmation: ast-grep

When the conform pass was a *consolidation* (peers rewritten to call a canonical helper), confirm the inline shape is gone:

```bash
ast-grep --pattern '<inline shape>' src/
```

Examples:

```bash
# After consolidating "name.slice(5).split('__')" onto fmtToolName:
ast-grep --pattern '$X.slice(5).split($_)' src/

# After making every route handler use wrapHandler:
ast-grep --pattern 'export function $_(req: Request) { try { $$$ } catch ($_) { $$$ } }' src/ui/api/

# After making every mutation emit a fully-populated AppEvent:
ast-grep --pattern 'eventBus.emitMutation({ type: $_, goalId: $_ })' src/goals/
```

Zero hits outside the canonical site = consolidation complete. Non-zero = still drift; iterate.

## When to skip ast-grep

- Pure propagation passes (no canonical helper, no inline shape to grep). `bun test.ts` is enough.
- The drift was behavioral (return shapes, retry counts) and not pattern-shaped. Tests are the right gate.

## Non-gates

These do **not** count as verification for a code-conform pass:

- "TypeScript looks correct" — needs `bun run build`.
- "Files copied" — needs `bun test.ts`.
- "Pattern looks aligned by eye" — needs the actual command.

## When tests don't exist

If a peer has no test coverage, **do not write one to satisfy the gate**. `bun test.ts` passing on existing tests is the bar. New tests belong in a separate, dedicated change. Note in the summary which peers were aligned without test coverage so the user can decide whether to backfill.

## On failure

If `bun test.ts` or `bun run build` fail after the conform pass:

1. Read the error.
2. The most common cause is a peer that diverged from the reference for a *good* reason — domain logic baked into the inline implementation that the canonical helper doesn't handle. Either extend the helper, or mark the peer as `// conform:exempt` with a one-line reason.
3. Re-run the gate.
4. If failures persist, revert the offending peer's edit and report it as a skip in the summary.

Never silence a failing test to make the conform pass go through.
