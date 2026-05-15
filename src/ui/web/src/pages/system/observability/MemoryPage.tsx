import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useObsMemory, useObsMemoryItems, useObsMemoryUsage, useObsMemorySearches, useTriggerSnapshot, useDeleteMemory, useUpdateMemory } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter, legendProps, xAxisDateProps } from '../../../components/charts/chartTheme';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { PageTitle } from '../../../components/layout/PageHeader';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { fmtNumber, shortDate, shortRelativeTime, granLabel, fmtLegendLabel, fmtMs, dateTime } from '../../../utils/format';
import { clsx } from 'clsx';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type TypeRow = { type: string; count: number };
type TagRow = { tag: string; count: number };
type MemoryItem = { id: string; content: string; memory_type: string; tags: string; created_at: string; updated_at: string };

export function MemoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const range = (searchParams.get('range') as TimeRange) ?? '30d';
  const granularity = (searchParams.get('granularity') as Granularity) ?? 'day';
  function setRange(r: TimeRange) { setSearchParams(p => { const n = new URLSearchParams(p); n.set('range', r); return n; }, { replace: true }); }
  function setGranularity(g: Granularity) { setSearchParams(p => { const n = new URLSearchParams(p); n.set('granularity', g); return n; }, { replace: true }); }
  const { data, isLoading, error, refetch } = useObsMemory();
  const snapshot = useTriggerSnapshot();
  const deleteMemory = useDeleteMemory();
  const updateMemory = useUpdateMemory();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const usage = useObsMemoryUsage(range, granularity);

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [activeSearch, setActiveSearch] = useState({ q: '', type: '', tag: '' });

  const [usageChartType, setUsageChartType] = useState<'bar' | 'line'>('bar');
  const [expandedSearch, setExpandedSearch] = useState<string | null>(null);
  const searches = useObsMemorySearches(range);

  const items = useObsMemoryItems({
    q: activeSearch.q || undefined,
    type: activeSearch.type || undefined,
    tag: activeSearch.tag || undefined,
    limit: 50,
  });

  function handleSearch() {
    setActiveSearch({ q: searchQuery, type: typeFilter, tag: tagFilter });
  }

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load memory data" retry={refetch} />;

  const latest = data.snapshots.length > 0 ? data.snapshots[0] : null;

  const typeRows: TypeRow[] = latest
    ? Object.entries(latest.byType).map(([type, count]) => ({ type, count }))
    : [];
  const typeOptions = typeRows.map((r) => r.type);

  const tagRows: TagRow[] = latest
    ? Object.entries(latest.byTag)
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
    : [];
  const tagOptions = tagRows.map((r) => r.tag);

  const typeColumns: Column<TypeRow>[] = [
    {
      key: 'type',
      label: 'Type',
      render: (row) => <span className="text-text-primary">{row.type}</span>,
    },
    {
      key: 'count',
      label: 'Count',
      align: 'right',
      sortable: true,
      render: (row) => <span className="font-mono">{fmtNumber(row.count)}</span>,
    },
  ];

  const tagColumns: Column<TagRow>[] = [
    {
      key: 'tag',
      label: 'Tag',
      render: (row) => <span className="text-text-primary">{row.tag}</span>,
    },
    {
      key: 'count',
      label: 'Count',
      align: 'right',
      sortable: true,
      render: (row) => <span className="font-mono">{fmtNumber(row.count)}</span>,
    },
  ];

  const memoryColumns: Column<MemoryItem>[] = [
    {
      key: 'content',
      label: 'Content',
      render: (row) => (
        <div className="max-w-lg">
          <p className="text-sm text-text-primary line-clamp-2">{row.content}</p>
          <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
            <span className="font-mono">{row.memory_type}</span>
            <span>{shortRelativeTime(row.created_at)}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'tags',
      label: 'Tags',
      width: '140px',
      render: (row) => {
        const tags = row.tags ? (row.tags.startsWith('[') ? JSON.parse(row.tags) : row.tags.split(',').map((t: string) => t.trim())) : [];
        return (
          <div className="flex flex-wrap gap-1">
            {(tags as string[]).slice(0, 5).map((tag: string) => (
              <span key={tag} className="rounded bg-bg-tertiary px-1.5 py-0.5 text-xs font-mono text-text-muted">
                {tag}
              </span>
            ))}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar
        title={
          <>
            <PageTitle>Memory</PageTitle>
            <button
              onClick={() => snapshot.mutate()}
              disabled={snapshot.isPending}
              className={clsx(
                'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                'bg-accent text-white hover:bg-accent-hover',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {snapshot.isPending ? 'Taking Snapshot...' : 'Take Snapshot'}
            </button>
          </>
        }
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      />

      {/* Stats */}
      {latest && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5 !mt-0">
          <StatCard label="Total Memories" value={fmtNumber(latest.total)} />
          <StatCard
            label="Health Score"
            value={`${(latest.health.score * 100).toFixed(0)}%`}
            accent={latest.health.score >= 0.8 ? 'success' : latest.health.score >= 0.5 ? 'warning' : 'error'}
          />
          <StatCard
            label="Stale"
            value={fmtNumber(latest.health.stale)}
            accent={latest.health.stale > 0 ? 'warning' : 'default'}
          />
          {usage.data && (
            <>
              <StatCard label={`Stores (${range})`} value={fmtNumber(usage.data.stores)} accent="success" />
              <StatCard label={`Searches (${range})`} value={fmtNumber(usage.data.searches)} />
            </>
          )}
        </div>
      )}

      {/* Usage chart + type donut */}
      {usage.data && usage.data.byDay.length > 0 && (
        <div className="flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            <ChartContainer
              title={granLabel(granularity, "Memory Operations")}
              chartType={usageChartType}
              onChartTypeChange={setUsageChartType}
            >
              {usageChartType === 'bar' ? (
                <BarChart data={usage.data.byDay}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...xAxisDateProps} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                  <Legend {...legendProps} />
                  <Bar isAnimationActive={false} dataKey="stores" stackId="usage" fill={CHART_PALETTE[1]} radius={[0, 0, 0, 0]} name="Stores" />
                  <Bar isAnimationActive={false} dataKey="searches" stackId="usage" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Searches" />
                </BarChart>
              ) : (
                <AreaChart data={usage.data.byDay}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...xAxisDateProps} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                  <Legend {...legendProps} />
                  <Area isAnimationActive={false} type="monotone" dataKey="stores" stackId="usage" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.3} strokeWidth={2} dot={false} name="Stores" />
                  <Area isAnimationActive={false} type="monotone" dataKey="searches" stackId="usage" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.3} strokeWidth={2} dot={false} name="Searches" />
                </AreaChart>
              )}
            </ChartContainer>
          </div>
          {typeRows.length > 0 && (
            <div className="w-1/4 min-w-[220px] shrink-0 bg-bg-secondary border border-border-primary rounded-lg p-3">
              <p className="text-xs font-medium text-text-secondary mb-2">By Type</p>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={typeRows}
                    dataKey="count"
                    nameKey="type"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={78}
                    strokeWidth={0}
                  >
                    {typeRows.map((_, index) => (
                      <Cell key={index} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [fmtNumber(value as number), fmtLegendLabel(String(name))]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1">
                {typeRows.map((row, i) => (
                  <div key={row.type} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                    <span className="text-xs text-text-muted truncate flex-1">{fmtLegendLabel(row.type)}</span>
                    <span className="text-xs text-text-secondary">{fmtNumber(row.count)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Type + Tag breakdown */}
      {latest && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 text-sm font-medium text-text-secondary">By Type</h2>
            <DataTable<TypeRow>
              data={typeRows}
              columns={typeColumns}
              keyField="type"
              onRowClick={(row) => { setTypeFilter(row.type); setActiveSearch((s) => ({ ...s, type: row.type })); }}
            />
          </div>
          <div>
            <h2 className="mb-3 text-sm font-medium text-text-secondary">Top Tags</h2>
            <DataTable<TagRow>
              data={tagRows}
              columns={tagColumns}
              keyField="tag"
              maxRows={15}
              onRowClick={(row) => { setTagFilter(row.tag); setActiveSearch((s) => ({ ...s, tag: row.tag })); }}
            />
          </div>
        </div>
      )}

      {/* Memory browser */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-text-secondary">Browse Memories</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search by keyword..."
            className="flex-1 rounded-md border border-border-primary bg-bg-tertiary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-36 rounded-md border border-border-primary bg-bg-tertiary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">All Types</option>
            {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="w-36 rounded-md border border-border-primary bg-bg-tertiary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">All Tags</option>
            {tagOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button
            onClick={handleSearch}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            Search
          </button>
        </div>

        {(activeSearch.q || activeSearch.type || activeSearch.tag) && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>Filters:</span>
            {activeSearch.q && <span className="rounded bg-bg-tertiary px-1.5 py-0.5">q="{activeSearch.q}"</span>}
            {activeSearch.type && <span className="rounded bg-bg-tertiary px-1.5 py-0.5">type={activeSearch.type}</span>}
            {activeSearch.tag && <span className="rounded bg-bg-tertiary px-1.5 py-0.5">tag={activeSearch.tag}</span>}
            <button
              onClick={() => { setSearchQuery(''); setTypeFilter(''); setTagFilter(''); setActiveSearch({ q: '', type: '', tag: '' }); }}
              className="text-accent hover:underline"
            >
              Clear
            </button>
          </div>
        )}

        {items.isLoading && <p className="text-sm text-text-muted">Loading memories...</p>}
        {items.data && items.data.items.length > 0 && (
          <DataTable<MemoryItem>
            data={items.data.items}
            columns={memoryColumns}
            keyField="id"
            expandedKey={expandedId}
            onExpandToggle={(key) => setExpandedId(key === expandedId ? null : key)}
            renderExpanded={(row) => (
              <div className="space-y-3">
                {editingId === row.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full rounded border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent resize-y min-h-[100px]"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateMemory.mutate({ id: row.id, content: editContent }, { onSuccess: () => setEditingId(null) })}
                        disabled={updateMemory.isPending}
                        className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 transition-colors"
                      >
                        {updateMemory.isPending ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1 text-xs border border-border-primary text-text-muted rounded hover:text-text-primary transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-text-primary
                      [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-1
                      [&_code]:font-mono [&_code]:bg-bg-tertiary [&_code]:px-1 [&_code]:rounded [&_code]:text-accent [&_code]:text-xs
                      [&_pre]:bg-bg-tertiary [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0
                      [&_ul]:list-disc [&_ul]:ml-4 [&_ul]:mb-1 [&_ol]:list-decimal [&_ol]:ml-4 [&_ol]:mb-1
                      [&_strong]:font-semibold [&_h1]:text-base [&_h1]:font-bold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold">
                      <Markdown remarkPlugins={[remarkGfm]}>{row.content}</Markdown>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-text-muted">
                      <span>Created {shortRelativeTime(row.created_at)}</span>
                      {row.updated_at !== row.created_at && <span>Updated {shortRelativeTime(row.updated_at)}</span>}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => { setEditingId(row.id); setEditContent(row.content); }}
                        className="px-3 py-1 text-xs border border-border-primary text-text-muted rounded hover:text-text-primary transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Delete this memory?')) {
                            deleteMemory.mutate(row.id, { onSuccess: () => setExpandedId(null) });
                          }
                        }}
                        disabled={deleteMemory.isPending}
                        className="px-3 py-1 text-xs border border-error/30 text-error rounded hover:bg-error/10 disabled:opacity-50 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          />
        )}
        {items.data && items.data.items.length === 0 && (activeSearch.q || activeSearch.type || activeSearch.tag) && (
          <p className="py-4 text-center text-sm text-text-muted">No memories matching filters.</p>
        )}
      </div>

      {/* Search History */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-text-secondary">Search History</h2>
          {searches.data && (
            <span className="text-xs text-text-muted">{fmtNumber(searches.data.totalSearches)} searches</span>
          )}
        </div>

        {searches.isLoading && <p className="text-sm text-text-muted">Loading search history...</p>}
        {searches.data && searches.data.invocations.length === 0 && (
          <p className="py-4 text-center text-sm text-text-muted">No memory searches recorded in this period.</p>
        )}
        {searches.data && searches.data.invocations.length > 0 && (
          <div className="rounded-lg border border-border-primary overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-primary bg-bg-tertiary">
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-muted w-36">Time</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">Query</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-muted w-20">Mode</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-text-muted w-16">Results</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-text-muted w-16">Duration</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-muted w-20">Session</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-primary">
                {searches.data.invocations.map((inv, idx) => {
                  const key = `${inv.timestamp}-${idx}`;
                  const isExpanded = expandedSearch === key;
                  return (
                    <>
                      <tr
                        key={key}
                        onClick={() => setExpandedSearch(isExpanded ? null : key)}
                        className={clsx(
                          'cursor-pointer transition-colors',
                          isExpanded ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary/50',
                          inv.isError && 'bg-error/5'
                        )}
                      >
                        <td className="px-3 py-2 font-mono text-xs text-text-muted whitespace-nowrap">{dateTime(inv.timestamp)}</td>
                        <td className="px-3 py-2 max-w-0">
                          <span className={clsx('block truncate text-xs', inv.isError ? 'text-error' : 'text-text-primary')}>
                            {inv.query || <span className="text-text-disabled italic">no query</span>}
                          </span>
                          {inv.tags && inv.tags.length > 0 && (
                            <span className="text-xs text-text-muted font-mono">tags: {inv.tags.join(', ')}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {inv.mode && (
                            <span className="text-xs font-mono rounded bg-bg-tertiary px-1.5 py-0.5 text-text-muted">{inv.mode}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-text-secondary">{inv.resultCount}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-text-muted">
                          {inv.durationMs != null ? fmtMs(inv.durationMs) : '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-text-muted">{inv.sessionId.slice(0, 8)}</td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${key}-expanded`} className="bg-bg-tertiary">
                          <td colSpan={6} className="px-4 py-3">
                            {inv.isError ? (
                              <p className="text-xs text-error font-mono">{inv.errorMessage || 'Error'}</p>
                            ) : inv.results.length === 0 ? (
                              <p className="text-xs text-text-muted italic">No memories returned.</p>
                            ) : (
                              <div className="space-y-2">
                                {inv.results.map((result, i) => (
                                  <div key={i} className="rounded border border-border-primary bg-bg-secondary p-3 space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {result.memory_type && (
                                        <span className="text-xs font-mono rounded bg-bg-tertiary px-1.5 py-0.5 text-text-muted">{result.memory_type}</span>
                                      )}
                                      {result.score != null && (
                                        <span className="text-xs text-text-muted font-mono">score: {result.score.toFixed(3)}</span>
                                      )}
                                      {result.tags && result.tags.length > 0 && (
                                        <span className="text-xs text-text-muted font-mono">{result.tags.join(', ')}</span>
                                      )}
                                    </div>
                                    <p className="text-xs text-text-primary leading-relaxed whitespace-pre-wrap">{result.content}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
