# Design Conform — Verification

After applying conform edits, gate on these checks before claiming done.

## Required gate

`bun run ui:smoke` — builds the bundle, boots the API, navigates every route in headless Chromium, asserts no render errors or 5xx responses.

This is the project's required gate for any UI change (per `.claude/CLAUDE.md` and `feedback_ui_done_requires_page_load`). `bun run --cwd src/ui build` alone is **not** sufficient — compilation does not catch runtime render errors.

```bash
bun run ui:smoke
```

If `ui:smoke` fails, do not claim done. Read the failure trace, fix the broken peer, re-run.

## When ui:smoke can't be run

Sandbox restrictions or missing Chromium can block `ui:smoke`. **Say so explicitly in the summary** — do not silently fall back to `bun run build` and claim success.

## Eyeball pass

After `ui:smoke` is green, load each affected route in the browser and visually compare against the reference. Start a one-off dev server on a free port ≥ 3002 (`PORT=<port> bun run --cwd src/ui start &`) and kill it when done — port 3001 belongs to the user and may not serve your code; port 3000 is prod. Specifically check:

1. **Side-by-side at the same scroll position** — open reference in one tab, peer in another. Hot-swap focus.
2. **Header line-up** — sidebar header baseline matches content header baseline. Off-by-2px is real drift.
3. **Empty-state pass** — clear filters / use a brand-new account / mock empty data. Confirm peer's empty state matches reference's.
4. **Loading-state pass** — throttle the network to "Slow 3G" in DevTools or block the API endpoint. Confirm peer's skeleton matches reference's.
5. **Error-state pass** — temporarily break the API call (rename endpoint, return 500). Confirm peer's error block matches reference's.

If any state visibly differs, that peer was not fully aligned — re-open the conform pass.

## Compare-by-route workflow

For multi-peer passes:

1. Pin the reference page open.
2. Walk through each peer in order.
3. For each peer, re-run the four-state checklist above.
4. Note any failures in the conform summary as "still drifted on <state>".

## Worktree-specific notes

When working in a worktree (`.worktrees/<name>`):

- **Do not** rely on the user's 3001 server — it serves a different checkout.
- Run `bun run ui:smoke` from the worktree root.
- For interactive eyeball checks, start a one-off server on a free port ≥ 3002 (`PORT=<port> bun run --cwd src/ui start &`) and **kill it when done**. Orphaned worktree servers cause confusion.

## Non-gates

These do **not** count as verification for a `design-review --mode fix` pass:

- `bun run --cwd src/ui build` alone — catches type errors, not render errors.
- "Diff looks right by eye" — needs `ui:smoke` + browser load.
- "Reference and peer use the same component name" — say nothing about runtime alignment.
- `bun test.ts` — useful for catching unrelated regressions, but does not load the UI.

## On failure

If `ui:smoke` fails after the conform pass:

1. Read the failure trace — usually a missing prop, a renamed import, or a broken token reference.
2. Fix the offending peer.
3. Re-run.
4. If the failure is in the *reference* (because the conform pass surfaced a pre-existing bug), fix it and note as "incidental fix" in the summary — but do not roll the conform pass into the same commit as a bug fix; split the commits.

Never silence a UI smoke failure by skipping the assertion or pinning the test to a specific render.
</state>