import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  useObsRatings,
  useObsToolSignals,
  useObsConsolidation,
  useObsSessionFiles,
} from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { PageHeader } from '../../../components/layout/PageHeader';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE } from '../../../components/charts/chartTheme';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { fmtNumber, shortRelativeTime, dateTime } from '../../../utils/format';
import { clsx } from 'clsx';

type Tab = 'sessions' | 're-edits' | 'ratings' | 'learning';

const TABS: { key: Tab; label: string }[] = [
  { key: 'sessions', label: 'Sessions' },
  { key: 're-edits', label: 'Re-edits' },
  { key: 'ratings', label: 'Ratings' },
  { key: 'learning', label: 'Learning' },
];

function SessionFilesTab() {
  const { data, isLoading, error, refetch } = useObsSessionFiles(200);
  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load session files" retry={refetch} />;

  type SessionFileRow = (typeof data.sessions)[number];
  const columns: Column<SessionFileRow>[] = [
    {
      key: 'timestamp',
      label: 'Time',
      width: '160px',
      render: (row) => (
        <span className="font-mono text-text-secondary whitespace-nowrap text-xs">{dateTime(row.timestamp)}</span>
      ),
    },
    {
      key: 'intent',
      label: 'Intent → Outcome',
      render: (row) => (
        <div className="space-y-0.5 min-w-0">
          {row.intent ? (
            <div className="text-text-primary text-sm truncate" title={row.intent}>
              {row.intent}
            </div>
          ) : (
            <div className="text-text-disabled text-sm">—</div>
          )}
          {row.outcome && (
            <div className="text-text-muted text-xs truncate" title={row.outcome}>
              → {row.outcome}
            </div>
          )}
          {row.notes.length > 0 && (
            <div className="text-text-muted text-xs truncate italic" title={row.notes.join(' | ')}>
              {row.notes[0]}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'filename',
      label: 'File',
      width: '180px',
      render: (row) => <span className="font-mono text-text-muted text-xs">{row.filename}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="font-heading text-lg font-medium text-text-secondary">Session Summaries</h2>
        <span className="text-text-muted text-sm">{data.total} sessions</span>
      </div>
      <DataTable<SessionFileRow>
        data={data.sessions}
        columns={columns}
        keyField="filename"
        maxRows={100}
      />
    </div>
  );
}

function ReEditsTab() {
  const { data, isLoading, error, refetch } = useObsToolSignals();
  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load tool signals" retry={refetch} />;

  type SignalRow = (typeof data.signals)[number];
  const columns: Column<SignalRow>[] = [
    {
      key: 'timestamp',
      label: 'Time',
      width: '160px',
      render: (row) => (
        <span className="font-mono text-text-secondary whitespace-nowrap text-xs">{dateTime(row.timestamp)}</span>
      ),
    },
    {
      key: 'file',
      label: 'File',
      render: (row) => <span className="font-mono text-text-primary text-sm">{row.file}</span>,
    },
    {
      key: 'count',
      label: 'Edits',
      width: '60px',
      align: 'right',
      render: (row) => (
        <span
          className={clsx(
            'font-mono text-sm font-medium',
            row.count >= 5 ? 'text-error' : row.count >= 3 ? 'text-warning' : 'text-text-secondary',
          )}
        >
          {row.count}+
        </span>
      ),
    },
    {
      key: 'sessionId',
      label: 'Session',
      width: '90px',
      render: (row) => <span className="font-mono text-text-muted text-xs">{row.sessionId.slice(0, 8)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label="Re-edit Events"
          value={fmtNumber(data.total)}
          accent={data.total > 10 ? 'warning' : data.total > 0 ? 'neutral' : 'success'}
        />
        <StatCard label="Unique Files" value={fmtNumber(data.byFile.length)} />
      </div>

      {data.byFile.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-text-secondary mb-3">Most Re-edited Files</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byFile.slice(0, 15)} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid {...gridProps} horizontal={false} />
                <XAxis type="number" {...axisProps} />
                <YAxis type="category" dataKey="file" {...axisProps} width={200} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar isAnimationActive={false} dataKey="count" name="Re-edit events" fill={CHART_PALETTE[4]} radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <DataTable<SignalRow> data={data.signals} columns={columns} keyField="timestamp" maxRows={100} />
    </div>
  );
}

function RatingsTab() {
  const { data, isLoading, error, refetch } = useObsRatings();
  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load ratings" retry={refetch} />;

  const positive = data.ratings.filter((r) => r.rating === 'positive' || r.rating === '👍').length;
  const negative = data.ratings.filter((r) => r.rating === 'negative' || r.rating === '👎').length;

  type RatingRow = (typeof data.ratings)[number];
  const columns: Column<RatingRow>[] = [
    {
      key: 'timestamp',
      label: 'Time',
      width: '160px',
      render: (row) => (
        <span className="font-mono text-text-secondary whitespace-nowrap text-xs">{dateTime(row.timestamp)}</span>
      ),
    },
    {
      key: 'rating',
      label: 'Rating',
      width: '80px',
      render: (row) => {
        const isPos = row.rating === 'positive' || row.rating === '👍';
        return <span className={clsx('text-sm font-medium', isPos ? 'text-success' : 'text-error')}>{isPos ? '👍' : '👎'}</span>;
      },
    },
    {
      key: 'type',
      label: 'Type',
      width: '100px',
      render: (row) => <span className="text-text-muted text-xs font-mono">{row.type ?? '—'}</span>,
    },
    {
      key: 'context',
      label: 'Context',
      render: (row) => <span className="text-text-secondary text-sm truncate">{row.context ?? '—'}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Ratings" value={fmtNumber(data.total)} />
        <StatCard label="Positive" value={fmtNumber(positive)} accent={positive > 0 ? 'success' : undefined} />
        <StatCard label="Negative" value={fmtNumber(negative)} accent={negative > 0 ? 'error' : undefined} />
      </div>

      {data.byDay.length > 0 && (
        <ChartContainer title="Ratings by Day" height={200}>
          <BarChart data={data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar isAnimationActive={false} dataKey="positive" name="Positive" stackId="a" fill={CHART_PALETTE[2]} />
            <Bar isAnimationActive={false} dataKey="negative" name="Negative" stackId="a" fill={CHART_PALETTE[4]} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ChartContainer>
      )}

      <DataTable<RatingRow> data={data.ratings} columns={columns} keyField="timestamp" maxRows={100} />
    </div>
  );
}

function LearningTab() {
  const { data, isLoading, error, refetch } = useObsConsolidation();
  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load consolidation state" retry={refetch} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-lg font-medium text-text-secondary mb-4">Consolidation State</h2>
        <div className="grid grid-cols-2 gap-4">
          <StatCard
            label="Last Run"
            value={data.state.lastRun ? shortRelativeTime(data.state.lastRun) : 'Never'}
          />
          <StatCard label="Memories Processed" value={fmtNumber(data.state.lastMemoryCount ?? 0)} />
        </div>
      </div>

      {data.rules.length > 0 ? (
        <div>
          <h3 className="text-sm font-medium text-text-secondary mb-3">Learned Rules ({data.rules.length})</h3>
          <div className="rounded-lg border border-border-primary bg-bg-secondary divide-y divide-border-primary/40">
            {data.rules.map((rule, i) => (
              <div key={i} className="px-4 py-3 text-sm text-text-primary">
                {rule}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-8 text-center text-sm text-text-muted">
          No learned rules yet. Rules are synthesized automatically after enough preference/error memories accumulate.
        </div>
      )}
    </div>
  );
}

export function SignalsPage() {
  const [tab, setTab] = useState<Tab>('sessions');

  return (
    <div className="space-y-6">
      <PageHeader title="Signals" />

      <div className="flex gap-1 border-b border-border-primary">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === key
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'sessions' && <SessionFilesTab />}
      {tab === 're-edits' && <ReEditsTab />}
      {tab === 'ratings' && <RatingsTab />}
      {tab === 'learning' && <LearningTab />}
    </div>
  );
}
