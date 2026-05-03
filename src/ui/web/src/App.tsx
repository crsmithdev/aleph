import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './theme';
import { Layout } from './components/layout/Layout';

// Life pages
import { GoalsPage } from './pages/life/GoalsPage';
import { GoalDetailPage } from './pages/life/GoalDetailPage';
import { TodosPage } from './pages/life/TodosPage';
import { HabitsPage } from './pages/life/HabitsPage';
import { SummaryPage } from './pages/life/SummaryPage';

// Research pages
import { ResearchLandingPage } from './pages/research/ResearchLandingPage';
import { ResearchHistoryPage } from './pages/research/ResearchHistoryPage';
import { ResearchQueryDetailPage } from './pages/research/ResearchQueryDetailPage';
import { ResearchPlanPage } from './pages/research/ResearchPlanPage';
import { ResearchWorkersPage } from './pages/research/ResearchWorkersPage';
import { ResearchConfigPage } from './pages/research/ResearchConfigPage';

// System pages
import { OverviewPage } from './pages/system/observability/OverviewPage';
import { ToolsPage } from './pages/system/observability/ToolsPage';
import { ToolDetailPage } from './pages/system/observability/ToolDetailPage';
import { HooksPage } from './pages/system/observability/HooksPage';
import { HookDetailPage } from './pages/system/observability/HookDetailPage';
import { TokensCostPage } from './pages/system/observability/TokensCostPage';
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
import { SignalsPage } from './pages/system/observability/SignalsPage';
import { SettingsPage } from './pages/system/SettingsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              {/* Root redirect */}
              <Route path="/" element={<Navigate to="/summary" replace />} />

              {/* Life */}
              <Route path="/life" element={<Navigate to="/summary" replace />} />
              <Route path="/summary" element={<SummaryPage />} />
              <Route path="/goals" element={<GoalsPage />} />
              <Route path="/goals/:id" element={<GoalDetailPage />} />
              <Route path="/todos" element={<TodosPage />} />
              <Route path="/habits" element={<HabitsPage />} />

              {/* Research */}
              <Route path="/research" element={<ResearchLandingPage />} />
              <Route path="/research/history" element={<ResearchHistoryPage />} />
              {/* Permanent redirect for old bookmarks: /research/queries → /research/history */}
              <Route path="/research/queries" element={<Navigate to="/research/history" replace />} />
              <Route path="/research/:id" element={<ResearchQueryDetailPage />} />
              <Route path="/research/:id/plan" element={<ResearchPlanPage />} />
              <Route path="/research/workers" element={<ResearchWorkersPage />} />
              <Route path="/research/config" element={<ResearchConfigPage />} />

              {/* Observability */}
              <Route path="/observability" element={<OverviewPage />} />
              <Route path="/observability/tools" element={<ToolsPage />} />
              <Route path="/observability/tools/:name" element={<ToolDetailPage />} />
              <Route path="/observability/hooks" element={<HooksPage />} />
              <Route path="/observability/hooks/:name" element={<HookDetailPage />} />
              <Route path="/observability/skills" element={<SkillsPage />} />
              <Route path="/observability/skills/:name" element={<SkillDetailPage />} />
              <Route path="/observability/tokens" element={<TokensCostPage />} />
              <Route path="/observability/subagents" element={<SubagentsPage />} />
              <Route path="/observability/sessions" element={<SessionsPage />} />
              <Route path="/observability/sessions/:id" element={<SessionTracePage />} />
              <Route path="/observability/sessions/:id/turns/:turnIndex" element={<TurnTracePage />} />
              <Route path="/observability/evals" element={<EvalsPage />} />
              <Route path="/observability/compaction" element={<CompactionPage />} />
              <Route path="/observability/events" element={<EventsPage />} />
              <Route path="/observability/memory" element={<MemoryPage />} />
              <Route path="/observability/signals" element={<SignalsPage />} />
              <Route path="/observability/db" element={<DbStatsPage />} />
              {/* Settings */}
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
