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
              {/* Redirects */}
              <Route path="/" element={<Navigate to="/life/summary" replace />} />

              {/* Life */}
              <Route path="/life/goals" element={<GoalsPage />} />
              <Route path="/life/goals/:id" element={<GoalDetailPage />} />
              <Route path="/life/todos" element={<TodosPage />} />
              <Route path="/life/habits" element={<HabitsPage />} />
              <Route path="/life/summary" element={<SummaryPage />} />

              {/* System — Observability */}
              <Route path="/system/observability" element={<Navigate to="/system/observability/overview" replace />} />
              <Route path="/system/observability/overview" element={<OverviewPage />} />
              <Route path="/system/observability/tools" element={<ToolsPage />} />
              <Route path="/system/observability/tools/:name" element={<ToolDetailPage />} />
              <Route path="/system/observability/hooks" element={<HooksPage />} />
              <Route path="/system/observability/hooks/:name" element={<HookDetailPage />} />
              <Route path="/system/observability/skills" element={<SkillsPage />} />
              <Route path="/system/observability/skills/:name" element={<SkillDetailPage />} />
              <Route path="/system/observability/tokens" element={<TokensCostPage />} />
              <Route path="/system/observability/sessions" element={<SessionsPage />} />
              <Route path="/system/observability/events" element={<EventsPage />} />
              <Route path="/system/observability/memory" element={<MemoryPage />} />
              <Route path="/system/observability/db" element={<DbStatsPage />} />

              {/* System — Settings */}
              <Route path="/system/settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
