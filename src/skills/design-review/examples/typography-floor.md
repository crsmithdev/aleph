---
title: Typography floor and role consistency
dimension: Tokens
---

# Typography floor — 14px minimum, three fonts, consistent weight roles

The lesson: the project's type scale stops at `text-xs` (12px). Anything smaller is an arbitrary value (`text-[10px]`, `text-[11px]`) and is almost always drift — small text needlessly used where a token tier would do. The conform pass keeps the floor at 12px (`text-xs`) for metadata and 14px for primary content, and routes everyone through the three project fonts.

## The reference

The project's type scale lives in `src/ui/web/src/index.css`:

```css
--text-xs:   0.75rem;    --text-xs--line-height:   1rem;      /* 12px / 16px */
--text-sm:   0.875rem;   /* 14px */
--text-base: 1rem;       /* 16px */
--text-lg:   1.125rem;   /* 18px */
--text-xl:   1.25rem;    /* 20px */
--text-2xl:  1.5rem;     /* 24px */
```

The contract:

- **Body / primary content** uses `text-base` (16px) or `text-sm` (14px). Never below 14px for content the user reads.
- **Metadata and helper labels** can drop to `text-xs` (12px) — timestamps, tag pills, table column headers, captions.
- **Below 12px is forbidden** — there is no `text-2xs` token, and arbitrary values like `text-[10px]` or `text-[11px]` are drift to remove.
- **Three fonts only** — `font-sans` (body), `font-heading` (titles), `font-mono` (code, IDs, timestamps). No fourth font.
- **Weight roles**:
  - `font-bold` (700) → page titles only (`PageTitle`)
  - `font-semibold` (600) → section headings, emphasized labels
  - `font-medium` (500) → buttons, badges, table column headers
  - `font-normal` (400) → body text (default; usually no class needed)

## The peers (drift to look for)

`grep -rEn "text-\[1[0-3]px\]" src/ui/web/src/` surfaces the floor violators directly. As of the last audit, there are real hits in:

- `src/ui/web/src/pages/system/observability/HooksPage.tsx:488` — `text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide` on a status badge.
- `src/ui/web/src/pages/system/SettingsPage.tsx:306` and `:310` — `text-[10px] font-semibold uppercase tracking-wider` on theme picker section labels.
- `src/ui/web/src/pages/system/observability/TurnTracePage.tsx:297, :322, :357` — `text-[11px]` on a hand-rolled table's header and body.
- `src/ui/web/src/pages/system/observability/SessionTracePage.tsx:344, :796, :797` — `text-[11px]` on tooltip and file list.

Drift forms beyond the floor:

1. **Hex colors instead of tokens** — peer wrote `text-[#888]` instead of `text-text-muted`. Won't follow theme changes.
2. **Tailwind default colors** — peer wrote `text-gray-500` instead of `text-text-muted`. Same problem.
3. **Inline `style={{ fontSize: '11px' }}`** — bypasses both the token system and the search.
4. **Fourth-font drift** — peer imported a Google Font for "personality" or used `font-serif`/`font-display`. Three fonts only.
5. **Weight role drift** — peer used `font-bold` on a section heading (should be `font-semibold`) or `font-medium` on body text (should be unstyled / `font-normal`).

## The diff (proposal)

For arbitrary-value floor violations:

```diff
-<span className="text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide">
+<span className="text-xs font-medium px-1.5 py-0.5 rounded uppercase tracking-wide">
   {row.group}
 </span>
```

```diff
-<div className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Dark</div>
+<div className="px-3 pt-1 pb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">Dark</div>
```

```diff
-<tr className="border-b border-border-primary text-[11px] font-medium uppercase tracking-wider text-text-muted">
+<tr className="border-b border-border-primary text-xs font-medium uppercase tracking-wider text-text-muted">
```

For raw-color drift:

```diff
-<span className="text-[#888]">{label}</span>
+<span className="text-text-muted">{label}</span>
```

For inline-style drift:

```diff
-<span style={{ fontSize: '11px' }}>{label}</span>
+<span className="text-xs">{label}</span>
```

## After + verification

1. `bun run --cwd src/ui build` — type-checks.
2. `bun run ui:smoke` — required gate.
3. **Re-run the grep**:

   ```bash
   grep -rEn "text-\[1[0-3]px\]|text-\[#" src/ui/web/src/
   # Expect: zero hits, or a small whitelist of `// conform:exempt` annotated cases.
   ```

4. Eyeball the affected routes — uppercase tracking-widest labels at `text-xs` should still feel small enough to read as metadata. If a peer regressed visually because 12px is too big in its context, the right fix is *layout* (more space around the element), not a smaller font.

## Why this is instructive

This case is the simplest of the three — pure token discipline. But it's the conform pass that runs *most often* in practice, because every new component imported or pasted from another project tends to bring its own ad-hoc font sizes. Run `/design-review` against this case after every "add a new page from a template" task and approve the resulting fixes, and the codebase stays inside the type system instead of drifting into one-off `text-[Npx]` values. The floor itself is small (a handful of `text-[10px]` hits today), but the *discipline* is high-leverage — every drop below 12px gets caught here.
