import { useState, useMemo } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useObsMemory, useObsMemoryItems, useObsMemoryUsage, useTriggerSnapshot } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ChartContainer, useChartType } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { fmtNumber, shortDate, relativeTime, granLabel, rangeToDays } from '../../../utils/format';
import { cn } from '../../../utils/cn';

type TypeRow = { type: string; count: number };
type TagRow = { tag: string; count: number };
type MemoryItem = { id: string; content: string; memory_type: string; tags: string; created_at: string; updated_at: string };

function bucketKey(ts: string, gran: Granularity): string {
  switch (gran) {
    case 'minute': return ts.slice(0, 16);
    case 'hour': return ts.slice(0, 13);
    case 'day': return ts.slice(0, 10);
  }
}

export function MemoryPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const { data, isLoading, error, refetch } = useObsMemory();
  const snapshot = useTriggerSnapshot();
  const usage = useObsMemoryUsage(range, granularity);

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [activeSearch, setActiveSearch] = useState({ q: '', type: '', tag: '' });

  const usageChart = useChartType('bar');
  const trendChart = useChartType('line');

  const items = useObsMemoryItems({
    q: activeSearch.q || undefined,
    type: activeSearch.type || undefined,
    tag: activeSearch.tag || undefined,
    limit: 50,
  });

  // Filter trend data by selected time range (must be before early returns)
  const trendData = useMemo(() => {
    if (!data) return [];
    const allSnapshots = data.snapshots.slice().reverse();
    const days = rangeToDays(range);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const filtered = allSnapshots.filter((s) => s.takenAt >= cutoff);
    const buckets = new Map<string, { date: string; total: number }>();
    for (const s of filtered) {
      const key = bucketKey(s.takenAt, granularity);
      buckets.set(key, { date: s.takenAt, total: s.total });
    }
    return Array.from(buckets.values());
  }, [data, range, granularity]);

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
      render: (row) => <span className="font-mono text-text-primary">{row.type}</span>,
    },
    {
      key: 'count',
      label: 'Count',
      align: 'right',
      sortable: true,
      render: (row) => fmtNumber(row.count),
    },
  ];

  const tagColumns: Column<TagRow>[] = [
    {
      key: 'tag',
      label: 'Tag',
      render: (row) => <span className="font-mono text-text-primary">{row.tag}</span>,
    },
    {
      key: 'count',
      label: 'Count',
      align: 'right',
      sortable: true,
      render: (row) => fmtNumber(row.count),
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
            <span>{relativeTime(row.created_at)}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'tags',
      label: 'Tags',
      render: (row) => {
        const tags = row.tags ? (row.tags.startsWith('[') ? JSON.parse(row.tags) : row.tags.split(',').map((t: string) => t.trim())) : [];
        return (
          <div className="flex flex-wrap gap-1">
            {(tags as string[]).slice(0, 5).map((tag: string) => (
              <span key={tag} className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-mono text-text-muted">
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
          <div className="flex items-center justify-between w-full">
            <h1 className="text-xl font-semibold text-text-primary">Memory</h1>
            <button
              onClick={() => snapshot.mutate()}
              disabled={snapshot.isPending}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                'bg-accent text-white hover:bg-accent-hover',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {snapshot.isPending ? 'Taking Snapshot...' : 'Take Snapshot'}
            </button>
          </div>
        }
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      />

      {/* Stats */}
      {latest && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
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

      {/* Usage chart */}
      {usage.data && usage.data.byDay.length > 0 && (
        <ChartContainer
          title={granLabel(granularity, "Memory Operations")}
          chartType={usageChart.chartType}
          onChartTypeChange={usageChart.setChartType}
        >
          {usageChart.chartType === 'bar' ? (
            <BarChart data={usage.data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
              <Legend />
              <Bar dataKey="stores" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Stores" />
              <Bar dataKey="searches" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Searches" />
            </BarChart>
          ) : (
            <LineChart data={usage.data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
              <Legend />
              <Line type="monotone" dataKey="stores" stroke={CHART_PALETTE[1]} strokeWidth={2} dot={false} name="Stores" />
              <Line type="monotone" dataKey="searches" stroke={CHART_PALETTE[0]} strokeWidth={2} dot={false} name="Searches" />
            </LineChart>
          )}
        </ChartContainer>
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

      {/* Memory count trend */}
      {trendData.length > 1 && (
        <ChartContainer
          title="Memory Count Over Time"
          chartType={trendChart.chartType}
          onChartTypeChange={trendChart.setChartType}
        >
          {trendChart.chartType === 'line' ? (
            <LineChart data={trendData}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
              <Line type="monotone" dataKey="total" stroke={CHART_PALETTE[0]} strokeWidth={2} dot={false} name="Memories" />
            </LineChart>
          ) : (
            <BarChart data={trendData}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
              <Bar dataKey="total" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Memories" />
            </BarChart>
          )}
        </ChartContainer>
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
            onChange={(e) => { setTypeFilter(e.target.value); setActiveSearch((s) => ({ ...s, type: e.target.value })); }}
            className="w-36 rounded-md border border-border-primary bg-bg-tertiary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">All Types</option>
            {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            value={tagFilter}
            onChange={(e) => { setTagFilter(e.target.value); setActiveSearch((s) => ({ ...s, tag: e.target.value })); }}
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
          />
        )}
        {items.data && items.data.items.length === 0 && (activeSearch.q || activeSearch.type || activeSearch.tag) && (
          <p className="py-4 text-center text-sm text-text-muted">No memories matching filters.</p>
        )}
      </div>
    </div>
  );
}
