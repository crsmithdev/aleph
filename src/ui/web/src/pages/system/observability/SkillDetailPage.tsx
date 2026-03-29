import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useObsSkillDetail } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, shortDate, dateTime, granLabel } from '../../../utils/format';
import { MarkdownBlock } from '../../../components/data/MarkdownBlock';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { cn } from '../../../utils/cn';

type InvocationRow = { timestamp: string; sessionId: string; project: string; params?: Record<string, unknown>; userRequest?: string };

export function SkillDetailPage() {
  const { name: rawName } = useParams<{ name: string }>();
  const skillName = decodeURIComponent(rawName ?? '');
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useObsSkillDetail(skillName, range);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load skill details" retry={refetch} />;

  const isCommand = data.type === 'command';
  const displayName = isCommand && !skillName.startsWith('/') ? `/${skillName}` : skillName;

  const successRate = data.totalCount > 0
    ? ((data.totalCount - data.errorCount) / data.totalCount) * 100
    : 100;

  const invocationColumns: Column<InvocationRow>[] = [
    {
      key: 'timestamp',
      label: 'Time',
      render: (row) => <span className="text-text-secondary">{dateTime(row.timestamp)}</span>,
    },
    {
      key: 'project',
      label: 'Project',
      render: (row) => <span className="font-mono text-xs text-text-muted">{row.project}</span>,
    },
    {
      key: 'sessionId',
      label: 'Session',
      render: (row) => <span className="font-mono text-xs text-text-muted">{row.sessionId.slice(0, 8)}</span>,
    },
    {
      key: 'userRequest',
      label: 'Request',
      width: '300px',
      render: (row) => {
        if (!row.userRequest) return <span className="text-text-muted">—</span>;
        const text = row.userRequest;
        const short = text.length > 80 ? text.slice(0, 80) + '...' : text;
        return (
          <span className="text-xs text-text-secondary" title={text}>{short}</span>
        );
      },
    },
    {
      key: 'params',
      label: 'Params',
      width: '200px',
      render: (row) => {
        if (!row.params) return <span className="text-text-muted">—</span>;
        const isExpanded = expandedRow === row.timestamp;
        const preview = JSON.stringify(row.params);
        const short = preview.length > 60 ? preview.slice(0, 60) + '...' : preview;
        return (
          <button
            onClick={(e) => { e.stopPropagation(); setExpandedRow(isExpanded ? null : row.timestamp); }}
            className="w-full text-left font-mono text-xs text-text-muted hover:text-text-primary"
          >
            {isExpanded ? (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(row.params, null, 2)}</pre>
            ) : (
              <span className="block truncate">{short}</span>
            )}
          </button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar
        title={
          <div className="flex items-center gap-3">
            <Link
              to="/observability/skills"
              className="text-sm text-text-muted hover:text-text-primary transition-colors"
            >
              &larr; Skills
            </Link>
            <h1 className="text-2xl font-bold font-mono text-text-primary">{displayName}</h1>
            <span className={cn(
              'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              isCommand
                ? 'bg-accent/10 text-accent border border-accent/20'
                : 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
            )}>
              {isCommand ? 'command' : 'skill'}
            </span>
          </div>
        }
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      />

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Invocations" value={fmtNumber(data.totalCount)} />
        <StatCard
          label="Errors"
          value={fmtNumber(data.errorCount)}
          accent={data.errorCount > 0 ? 'error' : 'default'}
        />
        <StatCard
          label="Success Rate"
          value={fmtPct(successRate)}
          accent={successRate >= 99 ? 'success' : successRate >= 95 ? 'warning' : 'error'}
        />
      </div>

      {data.byDay.length > 0 && (
        <ChartContainer title={granLabel(granularity, "Usage")}>
          <BarChart data={data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
            <Bar dataKey="count" fill={CHART_PALETTE[3]} radius={[2, 2, 0, 0]} name="Invocations" />
          </BarChart>
        </ChartContainer>
      )}

      {data.invocations.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-text-secondary">
            Recent Invocations ({data.invocations.length})
          </h2>
          <DataTable<InvocationRow>
            data={data.invocations}
            columns={invocationColumns}
            keyField="timestamp"
            maxRows={50}
          />
        </div>
      )}

      {data.sourceContent ? (
        <MarkdownBlock
          content={data.sourceContent}
          filename={isCommand ? `${skillName}.md` : `${skillName}/SKILL.md`}
        />
      ) : (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
          <p className="text-sm text-warning">
            Source file not found — no {isCommand ? 'command .md' : 'SKILL.md'} file found for <span className="font-mono">{displayName}</span>
          </p>
        </div>
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
