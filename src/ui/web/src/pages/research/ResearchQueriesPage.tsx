import { Icon } from '../../components/ui/Icon';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { useResearchQueries, useCreateResearchQuery, useUpdateResearchQuery, useRunAllResearch, useStopAllResearch, useClearResearchDB, useResearchDefaults, useResearchStats, useResearchSummary, useResearchErrorStatus, type OutputShape, type PromptShape, type PromptDepth, type ErrorKind } from '../../api/research-hooks';
import { Button } from '../../components/ui/Button';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { fmtCurrency, shortRelativeTime } from '../../utils/format';

type StatusFilter = 'all' | 'active' | 'paused' | 'exhausted' | 'halted' | 'completed';

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Paused', value: 'paused' },
  { label: 'Exhausted', value: 'exhausted' },
  { label: 'Halted', value: 'halted' },
  { label: 'Completed', value: 'completed' },
];

const statusDotColors: Record<string, string> = {
  active: 'bg-green-400',
  paused: 'bg-yellow-400',
  exhausted: 'bg-text-muted',
  halted: 'bg-red-400',
  completed: 'bg-blue-400',
  archived: 'bg-text-muted',
};

const statusBadgeColors: Record<string, string> = {
  active: 'bg-green-900/50 text-green-300',
  paused: 'bg-yellow-900/50 text-yellow-300',
  exhausted: 'bg-bg-tertiary text-text-secondary',
  halted: 'bg-red-900/50 text-red-300',
  completed: 'bg-blue-900/50 text-blue-300',
  archived: 'bg-bg-tertiary text-text-muted',
};

function Sparkline({ values, active }: { values: number[]; active: boolean }) {
  const max = Math.max(...values, 1);
  const w = 72;
  const h = 20;
  const stepX = values.length > 1 ? w / (values.length - 1) : w;
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`)
    .join(' ');
  const stroke = active ? '#c678dd' : '#848da0';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <title>7d findings: {values.join(' ')}</title>
      <polyline fill="none" stroke={stroke} strokeWidth={1.5} points={points} />
    </svg>
  );
}

const ERROR_KIND_LABEL: Record<ErrorKind, string> = {
  credit_exhausted: 'Credits exhausted',
  rate_limit: 'Rate-limited',
  overload: 'Provider overloaded',
};

const ERROR_KIND_ICON: Record<ErrorKind, string> = {
  credit_exhausted: 'credit_card_off',
  rate_limit: 'hourglass_top',
  overload: 'hourglass_top',
};

const ERROR_KIND_BADGE: Record<ErrorKind, string> = {
  credit_exhausted: 'bg-danger/15 text-danger',
  rate_limit: 'bg-warning/15 text-warning',
  overload: 'bg-warning/15 text-warning',
};

export function ResearchQueriesPage() {
  const { data: sessions = [], isLoading, isError } = useResearchQueries();
  const { data: errorStatus } = useResearchErrorStatus();
  const sessionErrorMap = new Map<string, ErrorKind>();
  // Take the worst error kind per session (credit_exhausted > overload > rate_limit).
  const severity: Record<ErrorKind, number> = { credit_exhausted: 3, overload: 2, rate_limit: 1 };
  for (const s of errorStatus?.sessions ?? []) {
    const prev = sessionErrorMap.get(s.session_id);
    if (!prev || severity[s.error_kind] > severity[prev]) sessionErrorMap.set(s.session_id, s.error_kind);
  }
  const createSession = useCreateResearchQuery();
  const updateSession = useUpdateResearchQuery();
  const runAll = useRunAllResearch();
  const stopAll = useStopAllResearch();
  const { data: defaults } = useResearchDefaults();
  const [newOpen, setNewOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState(3);
  const [maxTotalThreads, setMaxTotalThreads] = useState<number>(150);
  const [provider, setProvider] = useState<string>('openrouter');
  const [model, setModel] = useState<string>('deepseek/deepseek-chat');
  const [minSearches, setMinSearches] = useState<number>(2);
  const [gapAnalysis, setGapAnalysis] = useState<boolean>(true);
  const [maxGapSearches, setMaxGapSearches] = useState<number>(2);
  const [intent, setIntent] = useState<string>('');
  const [outputShape, setOutputShape] = useState<OutputShape | ''>('');
  const [hintShape, setHintShape] = useState<PromptShape | ''>('');
  const [hintDepth, setHintDepth] = useState<PromptDepth | ''>('');
  const clearDb = useClearResearchDB();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  function seedFromDefaults() {
    if (!defaults) return;
    setDepth(defaults.max_thread_depth);
    setMaxTotalThreads(defaults.max_total_threads);
    setMinSearches(defaults.min_searches_per_thread);
    setProvider(defaults.providers.primary);
    setModel(defaults.model);
    setGapAnalysis(defaults.gap_analysis.enabled);
    setMaxGapSearches(defaults.gap_analysis.max_gap_searches);
  }

  function toggleNewOpen() {
    if (!newOpen) {
      seedFromDefaults();
      setQuery('');
    }
    setNewOpen(!newOpen);
  }

  const visibleSessions = sessions.filter(s => s.status !== 'archived');
  const filteredSessions = statusFilter === 'all'
    ? visibleSessions
    : visibleSessions.filter(s => s.status === statusFilter);

  const { data: weekStats } = useResearchStats('7d', 'day');
  const weekSpend = weekStats?.totalCost ?? 0;
  const { data: summary } = useResearchSummary();
  const activeCount = visibleSessions.filter(s => s.status === 'active').length;
  const statusCounts: Record<StatusFilter, number> = {
    all: visibleSessions.length,
    active: activeCount,
    paused: visibleSessions.filter(s => s.status === 'paused').length,
    exhausted: visibleSessions.filter(s => s.status === 'exhausted').length,
    halted: visibleSessions.filter(s => s.status === 'halted').length,
    completed: visibleSessions.filter(s => s.status === 'completed').length,
  };

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    const hints: { shape?: PromptShape; depth?: PromptDepth } = {};
    if (hintShape) hints.shape = hintShape;
    if (hintDepth) hints.depth = hintDepth;
    createSession.mutate({
      prompt: query.trim(),
      intent: intent.trim() || null,
      output_shape: outputShape || null,
      hints: Object.keys(hints).length > 0 ? hints : undefined,
      config: {
        max_thread_depth: depth,
        max_total_threads: maxTotalThreads,
        min_searches_per_thread: minSearches,
        model: model || 'deepseek/deepseek-chat',
        providers: { primary: provider as 'anthropic' | 'openrouter' | 'ollama' },
        gap_analysis: { enabled: gapAnalysis, max_gap_searches: maxGapSearches },
      },
    }, {
      onSuccess: () => { setQuery(''); setIntent(''); setOutputShape(''); setHintShape(''); setHintDepth(''); setNewOpen(false); },
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="sticky top-0 z-10 h-14 bg-bg-primary flex items-center justify-between gap-2 mb-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">Queries</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {visibleSessions.length} quer{visibleSessions.length !== 1 ? 'ies' : 'y'}
            {activeCount > 0 && <> &middot; <span className="text-success">{activeCount} active</span></>}
            {weekSpend > 0 && <> &middot; {fmtCurrency(weekSpend)} spent &middot; 7d</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => stopAll.mutate()}
            loading={stopAll.isPending}
            disabled={runAll.isPending}
          >Pause All</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => runAll.mutate()}
            loading={runAll.isPending}
            disabled={stopAll.isPending}
          >Resume All</Button>
          <Button size="sm" onClick={toggleNewOpen}>+ New query</Button>
        </div>
      </div>

      {newOpen && (
        <form onSubmit={handleCreate} className="bg-bg-secondary border border-border-primary rounded-lg p-4 flex flex-col gap-3">
          <div className="flex gap-3 items-center">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Enter research topic..."
            className="flex-1 bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            autoFocus
          />
          <label className="flex items-center gap-1.5 text-sm text-text-muted shrink-0" title="Max follow-up depth. Lower = more focused, higher = broader exploration.">
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
          <label className="flex items-center gap-1.5 text-sm text-text-muted shrink-0" title="Hard cap on total threads spawned. Prevents runaway branching. 0 = unlimited.">
            Max threads
            <input
              type="number"
              min={0}
              max={2000}
              step={1}
              value={maxTotalThreads}
              onChange={e => setMaxTotalThreads(Number(e.target.value))}
              className="w-16 bg-bg-primary border border-border-primary rounded px-1.5 py-1 text-sm text-text-primary text-center focus:outline-none focus:border-accent"
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
          <label className="flex items-center gap-1.5 text-sm text-text-muted shrink-0" title="Output shape hint — guides the interpreter. Leave blank to let the agent infer.">
            Shape
            <select
              value={hintShape}
              onChange={e => setHintShape(e.target.value as PromptShape | '')}
              className="bg-bg-primary border border-border-primary rounded px-1.5 py-1 text-sm text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="">auto</option>
              <option value="answer">answer</option>
              <option value="list">list</option>
              <option value="table">table</option>
              <option value="brief">brief</option>
              <option value="dataset">dataset</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-sm text-text-muted shrink-0" title="Research depth hint. shallow = quick lookup; deep = multi-step investigation.">
            Effort
            <select
              value={hintDepth}
              onChange={e => setHintDepth(e.target.value as PromptDepth | '')}
              className="bg-bg-primary border border-border-primary rounded px-1.5 py-1 text-sm text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="">auto</option>
              <option value="shallow">shallow</option>
              <option value="normal">normal</option>
              <option value="deep">deep</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-sm text-text-muted shrink-0 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={gapAnalysis}
              onChange={e => setGapAnalysis(e.target.checked)}
              className="w-3.5 h-3.5 accent-accent"
            />
            Gaps
          </label>
          {gapAnalysis && (
            <label className="flex items-center gap-1.5 text-sm text-text-muted shrink-0">
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
            className="px-3 py-1.5 text-sm rounded border border-dashed border-border-secondary text-text-muted hover:text-red-400 hover:border-red-400/50 hover:bg-red-500/5 transition-colors shrink-0"
          >{clearDb.isPending ? 'Wiping...' : 'Wipe all'}</button>
          </div>
          <div className="flex gap-3 items-center">
            <label className="flex-1 flex flex-col gap-1 text-sm text-text-muted">
              <span>Intent (optional) — what kind of answer do you want? e.g. "a list of Berkeley orgs taking volunteers this quarter"</span>
              <input
                type="text"
                value={intent}
                onChange={e => setIntent(e.target.value)}
                placeholder="Optional steering brief — lead researcher uses this to prune tangents"
                className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-text-muted shrink-0">
              <span>Shape</span>
              <select
                value={outputShape}
                onChange={e => setOutputShape((e.target.value || '') as OutputShape | '')}
                className="bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="">Default (overview)</option>
                <option value="list_of_entities">List of entities</option>
                <option value="overview">Overview</option>
                <option value="comparison">Comparison</option>
                <option value="timeline">Timeline</option>
                <option value="how_to">How-to</option>
              </select>
            </label>
          </div>
        </form>
      )}

      {/* Status filter bar */}
      {!isLoading && !isError && visibleSessions.length > 0 && (
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map(f => {
            const active = statusFilter === f.value;
            const count = statusCounts[f.value];
            return (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={clsx(
                  'px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5',
                  active
                    ? 'bg-bg-tertiary text-text-primary'
                    : 'text-text-muted hover:text-text-secondary hover:bg-bg-secondary'
                )}
              >
                {f.label}
                <span className={clsx('tabular-nums', active ? 'text-text-muted' : 'text-text-muted/60')}>{count}</span>
              </button>
            );
          })}
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
                    {session.title || session.prompt}
                  </h3>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {sessionErrorMap.get(session.id) && (
                      <span
                        className={clsx(
                          'flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
                          ERROR_KIND_BADGE[sessionErrorMap.get(session.id)!],
                        )}
                        title={ERROR_KIND_LABEL[sessionErrorMap.get(session.id)!]}
                      >
                        <span className="material-symbols-outlined text-[14px] leading-none">
                          {ERROR_KIND_ICON[sessionErrorMap.get(session.id)!]}
                        </span>
                        {ERROR_KIND_LABEL[sessionErrorMap.get(session.id)!]}
                      </span>
                    )}
                    <span className={clsx(
                      'flex items-center gap-1.5 px-2 py-0.5 rounded text-sm font-medium',
                      statusBadgeColors[session.status]
                    )}>
                      <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', statusDotColors[session.status])} />
                      {session.status}
                    </span>
                  </div>
                </div>

                {/* Seed query */}
                <p className="text-sm text-text-muted mb-3 truncate">{session.prompt_short || session.prompt}</p>

                {/* Summary preview */}
                {session.summary ? (
                  <p className="text-sm text-text-secondary leading-relaxed line-clamp-3 flex-1">
                    {session.summary}
                  </p>
                ) : (
                  <p className="text-sm text-text-muted italic flex-1">No summary yet.</p>
                )}
              </Link>

              {/* Footer */}
              <div className="px-4 pb-3 pt-2 border-t border-border-primary flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 text-sm text-text-muted min-w-0">
                  {session.stats && (session.stats.findings + session.stats.concepts + session.stats.sources > 0) ? (
                    <div className="flex items-center gap-2.5 tabular-nums shrink-0">
                      <span title="Findings"><span className="text-text-secondary">{session.stats.findings}</span>F</span>
                      <span className="text-text-muted/50">·</span>
                      <span title="Concepts"><span className="text-text-secondary">{session.stats.concepts}</span>C</span>
                      <span className="text-text-muted/50">·</span>
                      <span title="Sources"><span className="text-text-secondary">{session.stats.sources}</span>S</span>
                    </div>
                  ) : (
                    <span>{new Date(session.created_at).toLocaleDateString()}</span>
                  )}
                  {session.stats && session.stats.findings_by_day.some(n => n > 0) && (
                    <span className="shrink-0 text-text-muted/70">
                      <Sparkline values={session.stats.findings_by_day} active={session.status === 'active'} />
                    </span>
                  )}
                  {session.stats?.last_step_at && (
                    <span className="shrink-0 text-sm" title={`Last step ${new Date(session.stats.last_step_at).toLocaleString()}`}>
                      {shortRelativeTime(session.stats.last_step_at)}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => updateSession.mutate({ id: session.id, status: 'archived' })}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-red-400 p-1 rounded shrink-0"
                  title="Archive"
                >
                  <Icon name="close" size="xs" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Summary cards footer */}
      {!isLoading && !isError && visibleSessions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
          {/* Top concepts this month */}
          <div className="bg-bg-secondary border border-border-primary rounded-lg p-4">
            <div className="text-sm text-text-muted font-medium tracking-wide">Top concepts this month</div>
            {summary && summary.topConcepts.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {summary.topConcepts.map(c => (
                  <span
                    key={c.name}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-bg-tertiary text-sm text-text-secondary"
                    title={`${c.finding_count} finding${c.finding_count !== 1 ? 's' : ''} · ${c.session_count} session${c.session_count !== 1 ? 's' : ''}`}
                  >
                    {c.name}
                    <span className="text-text-muted tabular-nums">{c.finding_count}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-2.5 text-sm text-text-muted italic">No concepts yet.</div>
            )}
            <div className="mt-2.5 text-sm text-text-muted">Cross-session concept reuse, last 30 days.</div>
          </div>

          {/* Extraction queue */}
          <div className="bg-bg-secondary border border-border-primary rounded-lg p-4">
            <div className="text-sm text-text-muted font-medium tracking-wide">Extraction queue</div>
            <div className="mt-2 font-heading text-2xl font-semibold text-text-primary tabular-nums">
              {summary?.extractionQueue.total ?? 0}
              <span className="ml-2 text-sm font-normal text-text-muted">pending</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />{summary?.extractionQueue.running ?? 0} running</span>
              <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />{summary?.extractionQueue.pending ?? 0} queued</span>
              <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />{summary?.extractionQueue.failed ?? 0} failed</span>
            </div>
          </div>

          {/* Spend last 7 days */}
          <div className="bg-bg-secondary border border-border-primary rounded-lg p-4">
            <div className="text-sm text-text-muted font-medium tracking-wide">Spend · last 7 days</div>
            <div className="mt-2 font-heading text-2xl font-semibold text-text-primary tabular-nums">{fmtCurrency(weekSpend)}</div>
            {weekStats?.byDay && weekStats.byDay.some(d => d.cost > 0) && (
              <div className="mt-2">
                <SpendSparkline byDay={weekStats.byDay.slice(-7)} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SpendSparkline({ byDay }: { byDay: Array<{ date: string; cost: number }> }) {
  const values = byDay.map(d => d.cost);
  const max = Math.max(...values, 0.0001);
  const w = 200;
  const h = 40;
  const stepX = values.length > 1 ? w / (values.length - 1) : w;
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`)
    .join(' ');
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <title>Daily spend (7d)</title>
      <polyline fill="none" stroke="#c678dd" strokeWidth={1.5} points={points} />
      <line x1={0} y1={h - 1} x2={w} y2={h - 1} stroke="#3e4452" strokeWidth={1} />
    </svg>
  );
}
