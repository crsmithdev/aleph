/**
 * Route table — pairs each path in `routes-meta.ts` with its rendered element.
 *
 * `App.tsx` consumes this to declare React Router routes. A drift check at
 * module load throws if any path in ROUTE_META lacks an element, or any
 * element key isn't a known path — making the two files structurally linked.
 *
 * Smoke metadata is attached as React Router's `handle` so Layout can read
 * it via `useMatches()` and apply `data-testid` to <main>.
 */

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { ROUTE_META } from './routes-meta';

// Life
import { GoalsPage } from './pages/life/GoalsPage';
import { GoalDetailPage } from './pages/life/GoalDetailPage';
import { TodosPage } from './pages/life/TodosPage';
import { HabitsPage } from './pages/life/HabitsPage';
import { SummaryPage } from './pages/life/SummaryPage';

// Research
import { ResearchLandingPage } from './pages/research/ResearchLandingPage';
import { ResearchLoopDetail } from './pages/research/ResearchLoopDetail';
import { ResearchMonitorsPage } from './pages/research/ResearchMonitorsPage';
import { ResearchConfigPage } from './pages/research/ResearchConfigPage';

// System
import { OverviewPage } from './pages/system/observability/OverviewPage';
import { ToolsPage } from './pages/system/observability/ToolsPage';
import { ToolDetailPage } from './pages/system/observability/ToolDetailPage';
import { HooksPage } from './pages/system/observability/HooksPage';
import { HookDetailPage } from './pages/system/observability/HookDetailPage';
import { SessionsPage } from './pages/system/observability/SessionsPage';
import { SkillsPage } from './pages/system/observability/SkillsPage';
import { SkillDetailPage } from './pages/system/observability/SkillDetailPage';
import { MemoryPage } from './pages/system/observability/MemoryPage';
import { EventsPage } from './pages/system/observability/EventsPage';
import { DbStatsPage } from './pages/system/observability/DbStatsPage';
import { SubagentsPage } from './pages/system/observability/SubagentsPage';
import { EvalsPage } from './pages/system/observability/EvalsPage';
import { CompactionPage } from './pages/system/observability/CompactionPage';
import { SessionTracePage } from './pages/system/observability/SessionTracePage';
import { TurnTracePage } from './pages/system/observability/TurnTracePage';
import { LearningPage } from './pages/system/observability/LearningPage';
import { SettingsPage } from './pages/system/SettingsPage';

const ELEMENTS: Record<string, ReactNode> = {
  '/': <Navigate to="/summary" replace />,
  '/life': <Navigate to="/summary" replace />,
  '/research/queries': <Navigate to="/research" replace />,
  '/research/history': <Navigate to="/research" replace />,
  '/observability/tokens': <Navigate to="/observability" replace />,

  '/summary': <SummaryPage />,
  '/goals': <GoalsPage />,
  '/goals/:id': <GoalDetailPage />,
  '/todos': <TodosPage />,
  '/habits': <HabitsPage />,

  '/research': <ResearchLandingPage />,
  '/research/:id': <ResearchLoopDetail />,
  '/research/monitors': <ResearchMonitorsPage />,
  '/research/config': <ResearchConfigPage />,

  '/observability': <OverviewPage />,
  '/observability/tools': <ToolsPage />,
  '/observability/tools/:name': <ToolDetailPage />,
  '/observability/hooks': <HooksPage />,
  '/observability/hooks/:name': <HookDetailPage />,
  '/observability/skills': <SkillsPage />,
  '/observability/skills/:name': <SkillDetailPage />,
  '/observability/subagents': <SubagentsPage />,
  '/observability/sessions': <SessionsPage />,
  '/observability/sessions/:id': <SessionTracePage />,
  '/observability/sessions/:id/turns/:turnIndex': <TurnTracePage />,
  '/observability/evals': <EvalsPage />,
  '/observability/compaction': <CompactionPage />,
  '/observability/events': <EventsPage />,
  '/observability/memory': <MemoryPage />,
  '/observability/learning': <LearningPage />,
  '/observability/db': <DbStatsPage />,

  '/settings': <SettingsPage />,
};

// Drift guard: every meta path has an element, and every element key is a meta path.
const metaPaths = new Set(ROUTE_META.map(m => m.path));
const elementPaths = new Set(Object.keys(ELEMENTS));
const missingElements = [...metaPaths].filter(p => !elementPaths.has(p));
const missingMeta = [...elementPaths].filter(p => !metaPaths.has(p));
if (missingElements.length || missingMeta.length) {
  throw new Error(
    `routes drift: meta missing elements=[${missingElements.join(', ')}]; elements missing meta=[${missingMeta.join(', ')}]`,
  );
}

export const ROUTES = ROUTE_META.map(m => ({
  path: m.path,
  smoke: m.smoke,
  element: ELEMENTS[m.path],
}));
