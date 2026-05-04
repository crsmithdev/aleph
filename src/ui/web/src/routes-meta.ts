/**
 * Route metadata — single source of truth for paths and smoke-test config.
 *
 * Pure data; no JSX. The smoke test (`src/ui/e2e/ui-smoke.test.ts`)
 * imports this in a Bun runtime that can't evaluate JSX modules. Element
 * mappings live in `routes.tsx`, which fails on app startup if any path
 * here lacks an element (or vice-versa).
 */

export type SmokeMeta = {
  /** Auto-applied to <main> as `data-testid` by Layout via useMatches. */
  testid: string;
  /** If set, smoke asserts an <h1> matching this regex exists. */
  heading?: RegExp;
};

export type RouteMeta = {
  path: string;
  /** Omit (or set undefined) to skip in smoke (redirects, dynamic detail pages). */
  smoke?: SmokeMeta;
};

export const ROUTE_META: readonly RouteMeta[] = [
  // Redirects — no smoke (destinations are smoked directly).
  { path: '/' },
  { path: '/life' },
  { path: '/research/queries' },

  // Life
  { path: '/summary', smoke: { testid: 'page-summary', heading: /^Summary$/ } },
  { path: '/goals', smoke: { testid: 'page-goals', heading: /^Goals$/ } },
  { path: '/goals/:id' },
  { path: '/todos', smoke: { testid: 'page-todos', heading: /^Todos$/ } },
  { path: '/habits', smoke: { testid: 'page-habits', heading: /^Habits$/ } },

  // Research
  { path: '/research', smoke: { testid: 'page-research-landing' } },
  { path: '/research/history', smoke: { testid: 'page-research-history' } },
  { path: '/research/:id' },
  { path: '/research/:id/plan' },
  { path: '/research/workers', smoke: { testid: 'page-research-workers', heading: /^Workers$/ } },
  { path: '/research/config', smoke: { testid: 'page-research-config', heading: /^Research Config$/ } },

  // Observability
  { path: '/observability', smoke: { testid: 'page-observability-overview' } },
  { path: '/observability/tools', smoke: { testid: 'page-observability-tools' } },
  { path: '/observability/tools/:name' },
  { path: '/observability/hooks', smoke: { testid: 'page-observability-hooks' } },
  { path: '/observability/hooks/:name' },
  { path: '/observability/skills', smoke: { testid: 'page-observability-skills' } },
  { path: '/observability/skills/:name' },
  { path: '/observability/tokens', smoke: { testid: 'page-observability-tokens' } },
  { path: '/observability/subagents', smoke: { testid: 'page-observability-subagents' } },
  { path: '/observability/sessions', smoke: { testid: 'page-observability-sessions' } },
  { path: '/observability/sessions/:id' },
  { path: '/observability/sessions/:id/turns/:turnIndex' },
  { path: '/observability/evals', smoke: { testid: 'page-observability-evals', heading: /^Evals$/ } },
  { path: '/observability/compaction', smoke: { testid: 'page-observability-compaction' } },
  { path: '/observability/events', smoke: { testid: 'page-observability-events' } },
  { path: '/observability/memory', smoke: { testid: 'page-observability-memory', heading: /^Memory$/ } },
  { path: '/observability/signals', smoke: { testid: 'page-observability-signals', heading: /^Signals$/ } },
  { path: '/observability/db', smoke: { testid: 'page-observability-db', heading: /^Database$/ } },

  // Settings
  { path: '/settings', smoke: { testid: 'page-settings', heading: /^Settings$/ } },
];
