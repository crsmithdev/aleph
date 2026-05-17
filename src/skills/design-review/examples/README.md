# Design Review — Examples

The merged `design-review` skill covers two modes. Examples in this directory:

## Audit mode

Example invocation: "audit the design", "review the ui", or "make this feel professional". Dispatched to the **`design-reviewer` agent** (needs browser tools + `bun run ui:smoke`). The agent walks every screen against the 18 design dimensions in `src/rules/design/RULES.md` (hierarchy, typography, color, components, state coverage, dark mode, density, responsiveness, accessibility, forms, and more), then emits a phased SARIF report with findings grouped into Critical, Refinement, and Polish phases. Read-only — no edits without approval.

## Fix mode (worked cases)

Run **inline** by this skill — direct source edits to React/CSS for approved `peer-drift` findings.

- `page-header-alignment.md` — propagate `<PageHeader>` chrome across 25+ consumers (Layout + Composition + Tokens)
- `table-consistency.md` — replace hand-rolled `<table>` and inline formatters with `<DataTable>` + `format.ts` helpers (Layout + Composition + Tokens + Microcopy)
- `typography-floor.md` — enforce 12px floor and three-font role discipline (Tokens)
