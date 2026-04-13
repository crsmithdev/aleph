import { Icon } from '../../components/ui/Icon';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useResearchQueries, useCreateResearchQuery, useUpdateResearchQuery, useResearchStats, useRunAllResearch, useStopAllResearch, useClearResearchDB } from '../../api/research-hooks';
import { Button } from '../../components/ui/Button';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { StatCard } from '../../components/data/StatCard';
import { ObsControlBar } from '../../components/data/ObsControlBar';
import { type TimeRange, type Granularity } from '../../components/data/TimeRangeSelector';
import { ChartContainer } from '../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter, legendProps, xAxisDateProps } from '../../components/charts/chartTheme';
import { fmtCurrency, fmtNumber, fmtPct, granLabel } from '../../utils/format';

type StatusFilter = 'all' | 'active' | 'paused' | 'completed';

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Paused', value: 'paused' },
  { label: 'Completed', value: 'completed' },
];

const statusDotColors: Record<string, string> = {
  active: 'bg-green-400',
  paused: 'bg-yellow-400',
  completed: 'bg-blue-400',
  archived: 'bg-text-muted',
};

const statusBadgeColors: Record<string, string> = {
  active: 'bg-green-900/50 text-green-300',
  paused: 'bg-yellow-900/50 text-yellow-300',
  completed: 'bg-blue-900/50 text-blue-300',
  archived: 'bg-bg-tertiary text-text-muted',
};

export function ResearchQueriesPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const { data: sessions = [], isLoading, isError } = useResearchQueries();
  const stats = useResearchStats(range, granularity);
  const createSession = useCreateResearchQuery();
  const updateSession = useUpdateResearchQuery();
  const runAll = useRunAllResearch();
  const stopAll = useStopAllResearch();
  const [newOpen, setNewOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState(9);
  const [provider, setProvider] = useState<string>(() => localStorage.getItem('research_default_provider') ?? 'openrouter');
  const [model, setModel] = useState<string>(() => localStorage.getItem('research_default_model') ?? 'deepseek/deepseek-chat');
  const [minSearches, setMinSearches] = useState<number>(() => Number(localStorage.getItem('research_default_min_searches') ?? '2'));
  const [gapAnalysis, setGapAnalysis] = useState<boolean>(() => localStorage.getItem('research_default_gap_analysis') !== 'false');
  const [maxGapSearches, setMaxGapSearches] = useState<number>(() => Number(localStorage.getItem('research_default_max_gap_searches') ?? '2'));
  const clearDb = useClearResearchDB();
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const visibleSessions = sessions.filter(s => s.status !== 'archived');
  const filteredSessions = statusFilter === 'all'
    ? visibleSessions
    : visibleSessions.filter(s => s.status === statusFilter);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    localStorage.setItem('research_default_provider', provider);
    if (model) localStorage.setItem('research_default_model', model);
    localStorage.setItem('research_default_min_searches', String(minSearches));
    localStorage.setItem('research_default_gap_analysis', String(gapAnalysis));
    localStorage.setItem('research_default_max_gap_searches', String(maxGapSearches));
    createSession.mutate({
      seed_query: query.trim(),
      config: {
        max_thread_depth: depth,
        min_searches_per_thread: minSearches,
        model: model || 'deepseek/deepseek-chat',
        providers: { primary: provider as 'anthropic' | 'openrouter' | 'ollama' },
        gap_analysis: { enabled: gapAnalysis, max_gap_searches: maxGapSearches },
      },
    }, {
      onSuccess: () => { setQuery(''); setDepth(8); setNewOpen(false); },
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <ObsControlBar
        title={
          <div className="flex items-center justify-between w-full">
            <div>
              <h1 className="font-heading text-2xl font-bold text-text-primary">Deep Research</h1>
              <p className="text-sm text-text-muted mt-0.5">
                {visibleSessions.length} quer{visibleSessions.length !== 1 ? 'ies' : 'y'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => stopAll.mutate()}
                loading={stopAll.isPending}
                disabled={runAll.isPending}
              >Stop All</Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => runAll.mutate()}
                loading={runAll.isPending}
                disabled={stopAll.isPending}
              >Run All</Button>
              <Button onClick={() => setNewOpen(!newOpen)}>+ New query</Button>
            </div>
          </div>
        }
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      />

      {stats.data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Queries" value={fmtNumber(stats.data.totalSessions)} accent="default" detailContent={<><span className="text-success font-medium">{stats.data.activeSessions}</span><span className="text-text-muted"> active</span></>} />
            <StatCard label="Findings" value={fmtNumber(stats.data.totalFindings)} accent="success" />
            <StatCard label="Total Cost" value={fmtCurrency(stats.data.totalCost)} />
            <StatCard
              label="Avg Confidence"
              value={fmtPct(stats.data.avgConfidence)}
              accent={stats.data.avgConfidence >= 70 ? 'success' : stats.data.avgConfidence >= 40 ? 'warning' : 'error'}
              detailContent={<><span className="text-text-muted">novelty </span><span className="text-text-secondary font-medium">{fmtPct(stats.data.avgNovelty)}</span></>}
            />
          </div>

          {stats.data.byDay.length > 0 && (
            <ChartContainer title={granLabel(granularity, "Activity")} chartType={chartType} onChartTypeChange={setChartType}>
              {chartType === 'bar' ? (
                <BarChart data={stats.data.byDay}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...xAxisDateProps} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                  <Legend {...legendProps} />
                  <Bar dataKey="findings" fill={CHART_PALETTE[0]} name="Findings" />
                  <Bar dataKey="sessions" fill={CHART_PALETTE[1]} name="Sessions" />
                </BarChart>
              ) : (
                <AreaChart data={stats.data.byDay}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...xAxisDateProps} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                  <Legend {...legendProps} />
                  <Area type="monotone" dataKey="findings" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.3} name="Findings" />
                  <Area type="monotone" dataKey="sessions" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.3} name="Sessions" />
                </AreaChart>
              )}
            </ChartContainer>
          )}
        </>
      )}

      {newOpen && (
        <form onSubmit={handleCreate} className="bg-bg-secondary border border-border-primary rounded-lg p-4 flex gap-3 items-center">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Enter research topic..."
            className="flex-1 bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            autoFocus
          />
          <label className="flex items-center gap-1.5 text-xs text-text-muted shrink-0">
            Depth
            <input
              type="number"
              min={1}
              max={20}
              value={depth}
              onChange={e => setDepth(Number(e.target.value))}
              className="w-12 bg-bg-primary border border-border-primary rounded px-1.5 py-1 text-sm text-text-primary text-center focus:outline-none focus:border-accent"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-text-muted shrink-0">
            Provider
            <select
              value={provider}
              onChange={e => setProvider(e.target.value)}
              className="bg-bg-primary border border-border-primary rounded px-1.5 py-1 text-sm text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="anthropic">Anthropic</option>
              <option value="openrouter">OpenRouter</option>
              <option value="ollama">Local</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-text-muted shrink-0">
            Model
            <input
              type="text"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="default"
              className="w-36 bg-bg-primary border border-border-primary rounded px-1.5 py-1 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-text-muted shrink-0">
            Min searches
            <input
              type="number"
              min={1}
              max={10}
              value={minSearches}
              onChange={e => setMinSearches(Number(e.target.value))}
              className="w-12 bg-bg-primary border border-border-primary rounded px-1.5 py-1 text-sm text-text-primary text-center focus:outline-none focus:border-accent"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-text-muted shrink-0 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={gapAnalysis}
              onChange={e => setGapAnalysis(e.target.checked)}
              className="w-3.5 h-3.5 accent-accent"
            />
            Gaps
          </label>
          {gapAnalysis && (
            <label className="flex items-center gap-1.5 text-xs text-text-muted shrink-0">
              Gap size
              <input
                type="number"
                min={1}
                max={10}
                value={maxGapSearches}
                onChange={e => setMaxGapSearches(Number(e.target.value))}
                className="w-12 bg-bg-primary border border-border-primary rounded px-1.5 py-1 text-sm text-text-primary text-center focus:outline-none focus:border-accent"
              />
            </label>
          )}
          <Button type="submit" loading={createSession.isPending}>Start</Button>
          <Button variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button>
          <button
            type="button"
            onClick={() => {
              if (!confirm('This will delete ALL research data. Continue?')) return;
              clearDb.mutate();
            }}
            disabled={clearDb.isPending}
            className="px-3 py-1.5 text-xs rounded border border-dashed border-border-secondary text-text-muted hover:text-red-400 hover:border-red-400/50 hover:bg-red-500/5 transition-colors shrink-0"
          >{clearDb.isPending ? 'Wiping...' : 'Wipe all'}</button>
        </form>
      )}

      {/* Status filter bar */}
      {!isLoading && !isError && visibleSessions.length > 0 && (
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={clsx(
                'px-3 py-1.5 rounded text-xs font-medium transition-colors',
                statusFilter === f.value
                  ? 'bg-bg-tertiary text-text-primary'
                  : 'text-text-muted hover:text-text-secondary hover:bg-bg-secondary'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <PageLoading />
      ) : isError ? (
        <ErrorState message="Failed to load research sessions." />
      ) : filteredSessions.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          {visibleSessions.length === 0
            ? 'No research queries yet. Start one to begin exploring.'
            : 'No queries match the selected filter.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filteredSessions.map(session => (
            <div
              key={session.id}
              className="group bg-bg-secondary border border-border-primary rounded-lg hover:border-border-secondary transition-colors flex flex-col"
            >
              <Link to={`/research/${session.id}`} className="flex flex-col flex-1 p-4 min-w-0">
                {/* Header: status badge + title */}
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="font-heading text-sm font-semibold text-text-primary leading-snug line-clamp-2 flex-1 min-w-0">
                    {session.title || session.seed_query}
                  </h3>
                  <span className={clsx(
                    'flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium shrink-0',
                    statusBadgeColors[session.status]
                  )}>
                    <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', statusDotColors[session.status])} />
                    {session.status}
                  </span>
                </div>

                {/* Seed query */}
                <p className="text-xs text-text-muted mb-3 truncate">{session.seed_query}</p>

                {/* Summary preview */}
                {session.summary ? (
                  <p className="text-xs text-text-secondary leading-relaxed line-clamp-3 flex-1">
                    {session.summary}
                  </p>
                ) : (
                  <p className="text-xs text-text-muted italic flex-1">No summary yet.</p>
                )}
              </Link>

              {/* Footer */}
              <div className="px-4 pb-3 pt-2 border-t border-border-primary flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 text-xs text-text-muted">
                  <span>{new Date(session.created_at).toLocaleDateString()}</span>
                </div>
                <button
                  onClick={() => updateSession.mutate({ id: session.id, status: 'archived' })}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-red-400 p-1 rounded"
                  title="Archive"
                >
                  <Icon name="close" size="xs" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
