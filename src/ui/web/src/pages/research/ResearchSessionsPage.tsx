import { Icon } from '../../components/ui/Icon';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { BarChart, Bar, AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useResearchSessions, useCreateResearchSession, useUpdateResearchSession, useResearchStats, useRunResearch, useRunAllResearch, useStopAllResearch, useResearchEnvCheck } from '../../api/research-hooks';
import { Button } from '../../components/ui/Button';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { StatCard } from '../../components/data/StatCard';
import { ObsControlBar } from '../../components/data/ObsControlBar';
import { type TimeRange, type Granularity } from '../../components/data/TimeRangeSelector';
import { ChartContainer } from '../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter, legendProps, xAxisDateProps } from '../../components/charts/chartTheme';
import { fmtCurrency, fmtNumber, fmtPct, shortDate, granLabel } from '../../utils/format';

const statusColors: Record<string, string> = {
  active: 'bg-green-900/50 text-green-300',
  paused: 'bg-yellow-900/50 text-yellow-300',
  exhausted: 'bg-bg-tertiary text-text-secondary',
  halted: 'bg-red-900/50 text-red-300',
  completed: 'bg-blue-900/50 text-blue-300',
  archived: 'bg-bg-tertiary text-text-muted',
};

export function ResearchSessionsPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const { data: sessions = [], isLoading, isError } = useResearchSessions();
  const stats = useResearchStats(range, granularity);
  const createSession = useCreateResearchSession();
  const updateSession = useUpdateResearchSession();
  const runResearch = useRunResearch();
  const runAll = useRunAllResearch();
  const stopAll = useStopAllResearch();
  const [newOpen, setNewOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState(9);
  const [provider, setProvider] = useState<string>(() => localStorage.getItem('research_default_provider') ?? 'openrouter');
  const [model, setModel] = useState<string>(() => localStorage.getItem('research_default_model') ?? '');
  const [minSearches, setMinSearches] = useState<number>(() => Number(localStorage.getItem('research_default_min_searches') ?? '2'));
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');
  const { data: envCheck } = useResearchEnvCheck();

  const visibleSessions = sessions.filter(s => s.status !== 'archived');

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    localStorage.setItem('research_default_provider', provider);
    if (model) localStorage.setItem('research_default_model', model);
    localStorage.setItem('research_default_min_searches', String(minSearches));
    createSession.mutate({
      prompt: query.trim(),
      config: {
        max_thread_depth: depth,
        min_searches_per_thread: minSearches,
        model: model || undefined,
        providers: { primary: provider as 'anthropic' | 'openrouter' | 'ollama' },
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
                {visibleSessions.length} session{visibleSessions.length !== 1 ? 's' : ''}
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
              <Button onClick={() => setNewOpen(!newOpen)}>+ New session</Button>
            </div>
          </div>
        }
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      />

      {/* Env warnings/errors banner */}
      {envCheck && (envCheck.errors.length > 0 || envCheck.warnings.length > 0 || envCheck.jina_balance !== null) && (
        <div className="flex flex-col gap-1.5">
          {envCheck.errors.map((e, i) => (
            <div key={i} className="rounded border border-red-500/50 bg-red-500/10 px-3 py-2 flex items-center gap-2">
              <Icon name="close" size="xs" className="text-red-400 shrink-0" />
              <span className="text-sm text-red-400 font-medium">{e}</span>
            </div>
          ))}
          {envCheck.warnings.map((w, i) => (
            <div key={i} className="rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 flex items-center gap-2">
              <span className="text-yellow-400 text-sm shrink-0">⚠</span>
              <span className="text-sm text-yellow-400">{w}</span>
            </div>
          ))}
          {envCheck.jina_balance !== null && (
            <div className="rounded border border-border-primary bg-bg-secondary px-3 py-2 flex items-center gap-2">
              <span className="text-sm text-text-muted">Jina balance:</span>
              <span className={clsx('text-sm font-medium tabular-nums', envCheck.jina_balance < 100_000 ? 'text-red-400' : envCheck.jina_balance < 1_000_000 ? 'text-yellow-400' : 'text-green-400')}>
                {envCheck.jina_balance.toLocaleString()} tokens
              </span>
            </div>
          )}
        </div>
      )}

      {stats.data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Sessions" value={fmtNumber(stats.data.totalSessions)} accent="default" detailContent={<><span className="text-success font-medium">{stats.data.activeSessions}</span><span className="text-text-muted"> active</span></>} />
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
                  <Bar isAnimationActive={false} dataKey="findings" fill={CHART_PALETTE[0]} name="Findings" />
                  <Bar isAnimationActive={false} dataKey="sessions" fill={CHART_PALETTE[1]} name="Sessions" />
                </BarChart>
              ) : (
                <AreaChart data={stats.data.byDay}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...xAxisDateProps} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                  <Legend {...legendProps} />
                  <Area isAnimationActive={false} type="monotone" dataKey="findings" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.3} name="Findings" />
                  <Area isAnimationActive={false} type="monotone" dataKey="sessions" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.3} name="Sessions" />
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
          <label className="flex items-center gap-1.5 text-sm text-text-muted shrink-0">
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
          <label className="flex items-center gap-1.5 text-sm text-text-muted shrink-0">
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
          <label className="flex items-center gap-1.5 text-sm text-text-muted shrink-0">
            Model
            <input
              type="text"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="default"
              className="w-36 bg-bg-primary border border-border-primary rounded px-1.5 py-1 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-text-muted shrink-0">
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
          <Button type="submit" loading={createSession.isPending}>Start</Button>
          <Button variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button>
        </form>
      )}

      {isLoading ? (
        <PageLoading />
      ) : isError ? (
        <ErrorState message="Failed to load research sessions." />
      ) : visibleSessions.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          No research sessions yet. Start one to begin exploring.
        </div>
      ) : (
        <div className="space-y-2">
          {visibleSessions.map(session => (
            <div
              key={session.id}
              className="bg-bg-secondary border border-border-primary rounded-lg p-4 hover:border-border-secondary transition-colors flex items-start gap-3"
            >
              <Link to={`/research/${session.id}`} className="flex-1 min-w-0">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-text-primary truncate">{session.title}</h3>
                    <p className="text-sm text-text-muted mt-1 truncate">{session.prompt_short || session.prompt}</p>
                  </div>
                  <span className={clsx('px-2 py-0.5 rounded text-sm font-medium ml-3', statusColors[session.status])}>
                    {session.status}
                  </span>
                </div>
                {session.summary && (
                  <p className="text-sm text-text-secondary mt-2 line-clamp-2">{session.summary}</p>
                )}
                <p className="text-sm text-text-muted mt-2">
                  Created {new Date(session.created_at).toLocaleDateString()}
                </p>
              </Link>
              <button
                onClick={() => updateSession.mutate({ id: session.id, status: 'archived' })}
                className="text-sm text-text-muted hover:text-red-400 transition-colors shrink-0 mt-1"
                title="Archive"
              >
                Archive
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
