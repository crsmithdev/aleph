---
title: Page-header alignment across pages
dimension: Layout + Composition + Tokens
---

# Page-header alignment — same chrome on every page

The lesson: every top-level page should mount its title in `<PageHeader>`, every detail page should mount its breadcrumb via `<PageTitleLink>` + `<PageTitleSeparator>` + `<PageTitle>`, and the row that contains them should be the same height (`h-14`) so the sidebar header and the content header share a baseline. Drift here makes the whole UI feel uneven before the user can name why.

## The reference

`src/ui/web/src/components/layout/PageHeader.tsx` is the canonical primitive. The contract:

```tsx
const TITLE_BASE = 'font-heading text-2xl font-bold leading-tight';

export function PageTitle({ children, className }) {
  return <h1 className={clsx(TITLE_BASE, 'text-text-primary truncate min-w-0 flex-1', className)}>{children}</h1>;
}

export function PageTitleLink({ to, children }) {
  return <NavLink to={to} className={clsx(TITLE_BASE, 'text-text-muted hover:text-text-primary transition-colors whitespace-nowrap shrink-0')}>{children}</NavLink>;
}

export function PageTitleSeparator() {
  return <span className={clsx(TITLE_BASE, 'text-text-muted shrink-0')} aria-hidden>&raquo;</span>;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  const titleNode = typeof title === 'string' ? <PageTitle>{title}</PageTitle> : title;
  return (
    <div className="mb-6">
      <div className="h-14 flex items-center gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">{titleNode}</div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {subtitle && <p className="text-xs text-text-muted mt-2 leading-tight">{subtitle}</p>}
    </div>
  );
}
```

Three rules the primitive enforces:

1. **Title font is fixed** — `font-heading text-2xl font-bold leading-tight`. Every title.
2. **Header row height is fixed** — `h-14`. So the sidebar's top header and the content's top header share a baseline.
3. **Bottom margin is fixed** — `mb-6`. Same air below every page header.

Detail pages with breadcrumbs follow this shape (`src/ui/web/src/pages/research/ResearchQueryDetailPage.tsx`):

```tsx
<PageHeader title={
  <>
    <PageTitleLink to="/research">Research Sessions</PageTitleLink>
    <PageTitleSeparator />
    <PageTitle>{session.title}</PageTitle>
  </>
} actions={...} />
```

Top-level pages follow this shape (`src/ui/web/src/pages/system/SettingsPage.tsx`):

```tsx
<PageHeader title="Settings" />
```

## The peers (drift to look for)

Across the 25+ `<PageHeader>` consumers (`grep -rln PageHeader src/ui/web/src/pages/`), drift takes these shapes:

1. **Bare `<PageTitle>` outside a `<PageHeader>`** — peer renders `<PageTitle>Deep Research</PageTitle>` directly inside the page (`src/ui/web/src/pages/research/ResearchSessionsPage.tsx:72`). Result: no `h-14` row, no `mb-6`, page header height differs from peers.
2. **Hand-rolled `<h1>`** — peer skipped the primitive entirely: `<h1 className="text-2xl font-bold mb-4">My Page</h1>`. Different font (no `font-heading`), different bottom margin (`mb-4` vs `mb-6`).
3. **Detail page with no breadcrumb slot** — peer is a detail page but renders only `<PageHeader title={item.name} />` instead of using `PageTitleLink` + `PageTitleSeparator` + `PageTitle`. User loses the back-link affordance.
4. **Title prop is a string for a detail page** — peer passes a string title even though it should be a breadcrumb fragment. The check: any page nested under `/x/:id` should use the breadcrumb shape.
5. **Subtitle styled inline** — peer wrote `<p className="text-sm text-text-muted">Description</p>` next to the header instead of using the `subtitle` prop. Different font size (`text-sm` vs `text-xs`), wrong vertical position.
6. **Actions hand-rolled** — peer rendered buttons in a flexbox above or below the title instead of passing them via the `actions` prop. Result: actions misaligned with the title, different row height.

## The diff (proposal)

For a peer mounting a bare `<PageTitle>` outside `<PageHeader>` (`ResearchSessionsPage.tsx`):

```diff
-import { PageTitle } from '../../components/layout/PageHeader';
+import { PageHeader } from '../../components/layout/PageHeader';

 // …

-<div className="mb-4">
-  <PageTitle>Deep Research</PageTitle>
-</div>
+<PageHeader title="Deep Research" />
```

For a peer with a hand-rolled `<h1>`:

```diff
-<h1 className="text-2xl font-bold mb-4">{title}</h1>
-{description && <p className="text-sm text-text-muted">{description}</p>}
+<PageHeader title={title} subtitle={description} />
```

For a detail page with a string title that should be a breadcrumb:

```diff
-<PageHeader title={item.name} />
+<PageHeader title={
+  <>
+    <PageTitleLink to="/items">Items</PageTitleLink>
+    <PageTitleSeparator />
+    <PageTitle>{item.name}</PageTitle>
+  </>
+} />
```

## After + verification

1. `bun run --cwd src/ui build` — type-checks.
2. `bun run ui:smoke` — required gate.
3. **The eyeball test that matters most for this conform pass:**
   - Open the reference page and a peer page in side-by-side browser tabs.
   - Look at the top of each page. The page title, the sidebar's header label, and any sticky chrome should sit on the same horizontal line.
   - Off-by-2px is real drift — confirm `h-14` and `mb-6` survived the edit.
4. For breadcrumb peers: click the link element. It should navigate to the parent route. If it doesn't, the breadcrumb wiring is broken.

## Why this is instructive

`<PageHeader>` is the highest-leverage primitive in the project's layout system — it's the chrome users see first, and inconsistency here is the inconsistency users notice first. Whenever a new page is added, this is the conform pass to run. Whenever the user reports "the header looks off on this page," this is the conform pass to run. The fix is almost always "use the primitive and pass the right shape to it" — never roll the chrome by hand.
