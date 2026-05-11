---
title: Table consistency across DataTable consumers
dimension: Layout + Composition + Tokens + Microcopy
---

# Table consistency — column typing, formatting, sortability

The lesson: a table with one expanding "long-string" column and the rest sized to content is the project's house style. Every table peer should follow it. Drift takes the form of multiple expanding columns, hand-rolled `<table>` elements, inconsistent date/number formatting, and ad-hoc font sizes.

## The reference: `<DataTable>` itself

`src/ui/web/src/components/data/DataTable.tsx` is the shared primitive. The contract it enforces (so peers don't have to think about it):

- **Column sizing** — `col.shrink: true` → `width: 1px` (collapses to content width); `col.width: '150px'` → fixed; default → `width: 100%, maxWidth: 0` (one expanding column per table; if multiple, the layout breaks).
- **No wrapping** — every cell has `whitespace-nowrap`. No multi-line cell content; long strings elide via `text-ellipsis`.
- **Header row** — `text-xs uppercase tracking-widest text-text-muted`, never anything else.
- **Body cells** — `px-4 py-2.5 align-middle`, `text-base`, alignment from `col.align`.
- **Sort** — `col.sortable: true` enables it; the table handles the click + arrow indicator. Default sort dir is `desc`.
- **Empty** — `<p class="py-8 text-center text-sm text-text-muted">{emptyMessage}</p>`. Default copy: `"No data"`.

A clean consumer — `src/ui/web/src/pages/system/observability/EvalsPage.tsx`:

```tsx
const columns: Column<EvalRun>[] = [
  { key: 'ts', label: 'Time', width: '150px',
    render: (row) => <span className="font-mono text-text-muted text-xs">{dateTime(row.ts)}</span> },
  { key: 'scenarioName', label: 'Scenario',
    render: (row) => <span className="text-text-primary">{row.scenarioName}</span> },
  { key: 'duration', label: 'Duration', align: 'right', shrink: true,
    render: (row) => <span className="font-mono text-text-muted">{fmtMs(row.duration)}</span> },
  // …
];
```

Pattern: timestamp uses `dateTime()` from `format.ts`, numeric durations use `fmtMs()`, fixed-width column for time, shrink for numerics, expanding for the scenario name.

## The peers (drift to look for)

Across the 14 DataTable consumers (`grep -rln DataTable src/ui/web/src/`), drift takes these shapes:

1. **Multiple expanding columns** — peer didn't set `width` or `shrink: true` on numeric columns, so two columns both try to be 100% wide. Layout collapses unpredictably.
2. **Inline date/time formatting** — peer uses `new Date(row.ts).toLocaleString()` instead of `dateTime(row.ts)` from `format.ts`. Drift in display format across pages.
3. **Inline number formatting** — peer renders `${row.count}` raw instead of `fmtNumber(row.count)`. Tables show `12345` next to `12.3K` on the next page.
4. **Hand-rolled `<table>`** — peer didn't use `DataTable` at all and wrote a `<table>` from scratch (e.g. `TurnTracePage.tsx:297` rolls its own `<table>` with `text-[11px]` headers).
5. **Inconsistent header styling** — peer used `text-text-muted text-xs` but bare-rolled, missing `uppercase tracking-widest` from the canonical header.
6. **Empty-state copy** — peer set `emptyMessage="No items."` (with a period) instead of `"No data"` (without).
7. **Sort opt-out** — peer didn't set `sortable: true` on any column. User can't sort the table even though the data supports it.

## The diff (proposal)

For a peer with multiple drift dimensions, the minimal-edit shape is:

```diff
-<table className="w-full">
-  <thead>
-    <tr className="border-b border-border-primary text-[11px] font-medium uppercase tracking-wider text-text-muted">
-      <th className="text-left px-4 py-2.5">Tool</th>
-      <th className="text-right px-4 py-2.5">Calls</th>
-      <th className="text-right px-4 py-2.5">Last used</th>
-    </tr>
-  </thead>
-  <tbody>
-    {rows.map((r) => (
-      <tr key={r.id} className="border-b border-border-primary/50">
-        <td className="px-4 py-2.5">{r.tool}</td>
-        <td className="px-4 py-2.5 text-right">{r.calls}</td>
-        <td className="px-4 py-2.5 text-right">{new Date(r.lastUsed).toLocaleString()}</td>
-      </tr>
-    ))}
-  </tbody>
-</table>
+<DataTable<Row>
+  data={rows}
+  keyField="id"
+  columns={[
+    { key: 'tool',     label: 'Tool',      sortable: true,
+      render: (r) => <span className="text-text-primary">{r.tool}</span> },
+    { key: 'calls',    label: 'Calls',     align: 'right', shrink: true, sortable: true,
+      render: (r) => <span className="font-mono text-text-muted">{fmtNumber(r.calls)}</span> },
+    { key: 'lastUsed', label: 'Last used', width: '150px',  sortable: true,
+      render: (r) => <span className="font-mono text-text-muted text-xs">{dateTime(r.lastUsed)}</span> },
+  ]}
+/>
```

Result: one expanding column (`tool`), fixed-width timestamp, shrunk numeric, all sortable, dates and numbers go through the project's formatters.

## After + verification

1. `bun run --cwd src/ui build` — type-checks.
2. `bun run ui:smoke` — required gate. If a route renders an empty table after the swap, it'll fail here.
3. Eyeball: load each affected page. Confirm one column expands, others sized to content, headers look identical to the reference page, sort arrows appear on click, dates and numbers render in the project's formats.

## Why this is instructive

`<DataTable>` already encodes the rules; peers that don't use it are *re-deciding* every rule from scratch — and they always re-decide differently. The single most valuable conform pass on the UI is "every table must be a `<DataTable>`." The second is "every `<DataTable>` consumer must use the project's `format.ts` helpers for time, number, and currency." This case demonstrates both shapes — replace the hand-rolled `<table>`, then route the cells through the formatters.
