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
import { ResearchSessionsPage } from './pages/research/ResearchSessionsPage';
import { ResearchSessionDetailPage } from './pages/research/ResearchSessionDetailPage';
import { ResearchPlanPage } from './pages/research/ResearchPlanPage';
import { MonitorsPage } from './pages/research/MonitorsPage';
import { MonitorDetailPage } from './pages/research/MonitorDetailPage';

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
import { SessionTracePage } from './pages/system/observability/SessionTracePage';
import { TurnTracePage } from './pages/system/observability/TurnTracePage';
import { SettingsPage } from './pages/system/SettingsPage';

// Research pages
import { ResearchSessionsPage } from './pages/research/ResearchSessionsPage';
import { ResearchSessionDetailPage } from './pages/research/ResearchSessionDetailPage';

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

              {/* Backward compat redirects */}
              <Route path="/life/summary" element={<Navigate to="/summary" replace />} />
              <Route path="/life/goals" element={<Navigate to="/goals" replace />} />
              <Route path="/life/goals/:id" element={<Navigate to="/goals/:id" replace />} />
              <Route path="/life/todos" element={<Navigate to="/todos" replace />} />
              <Route path="/life/habits" element={<Navigate to="/habits" replace />} />
              <Route path="/system/observability" element={<Navigate to="/observability" replace />} />
              <Route path="/system/observability/*" element={<Navigate to="/observability/*" replace />} />
              <Route path="/system/settings" element={<Navigate to="/settings" replace />} />

              {/* Life */}
              <Route path="/summary" element={<SummaryPage />} />
              <Route path="/goals" element={<GoalsPage />} />
              <Route path="/goals/:id" element={<GoalDetailPage />} />
              <Route path="/todos" element={<TodosPage />} />
              <Route path="/habits" element={<HabitsPage />} />

              {/* Research */}
              <Route path="/research" element={<ResearchSessionsPage />} />
              <Route path="/research/:id" element={<ResearchSessionDetailPage />} />
              <Route path="/research/:id/plan" element={<ResearchPlanPage />} />
              <Route path="/research/monitors" element={<MonitorsPage />} />
              <Route path="/research/monitors/:id" element={<MonitorDetailPage />} />

              {/* Observability */}
              <Route path="/observability" element={<Navigate to="/observability/overview" replace />} />
              <Route path="/observability/overview" element={<OverviewPage />} />
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
              <Route path="/observability/events" element={<EventsPage />} />
              <Route path="/observability/memory" element={<MemoryPage />} />
              <Route path="/observability/db" element={<DbStatsPage />} />
              {/* Research */}
              <Route path="/research" element={<ResearchSessionsPage />} />
              <Route path="/research/:id" element={<ResearchSessionDetailPage />} />

              {/* Settings */}
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
