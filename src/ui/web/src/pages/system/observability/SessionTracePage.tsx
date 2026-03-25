import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useObsSessionTrace } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { type TimeRange } from '../../../components/data/TimeRangeSelector';
import { fmtNumber, fmtMs, fmtCurrency, dateTime } from '../../../utils/format';
import { cn } from '../../../utils/cn';

type TurnRow = {
  index: number;
  userMessage: string;
  startTime: string;
  durationMs: number;
  toolCount: number;
  hookCount: number;
  errorCount: number;
  tokenCount: number;
  cost: number;
  model?: string;
};

function fmtDuration(ms: number): string {
  if (ms < 60000) return fmtMs(ms);
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

function cleanMessage(msg: string): string {
  return msg
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function SessionTracePage() {
  const { id: rawId } = useParams<{ id: string }>();
  const sessionId = decodeURIComponent(rawId ?? '');
  const navigate = useNavigate();
  const [range] = useState<TimeRange>('30d');
  const { data, isLoading, error, refetch } = useObsSessionTrace(sessionId, range);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load session trace" retry={refetch} />;

  const totalTools = data.turns.reduce((s, t) => s + t.spans.filter((sp) => sp.kind === 'tool').length, 0);
  const totalHooks = data.turns.reduce((s, t) => s + t.spans.filter((sp) => sp.kind === 'hook').length, 0);
  const errorSpans = data.turns.reduce((s, t) => s + t.spans.filter((sp) => sp.isError).length, 0);

  const turnRows: TurnRow[] = data.turns.map((t) => ({
    index: t.index,
    userMessage: t.userMessage,
    startTime: t.startTime,
    durationMs: t.durationMs,
    toolCount: t.spans.filter((s) => s.kind === 'tool').length,
    hookCount: t.spans.filter((s) => s.kind === 'hook').length,
    errorCount: t.spans.filter((s) => s.isError).length,
    tokenCount: t.tokenCount || 0,
    cost: t.cost || 0,
    model: t.model,
  }));

  const turnColumns: Column<TurnRow>[] = [
    {
      key: 'index',
      label: '#',
      width: '3rem',
      render: (row) => <span className="text-text-muted font-mono text-xs">{row.index + 1}</span>,
    },
    {
      key: 'startTime',
      label: 'Time',
      width: '10rem',
      render: (row) => <span className="text-text-secondary text-xs">{dateTime(row.startTime)}</span>,
    },
    {
      key: 'userMessage',
      label: 'Prompt',
      render: (row) => {
        const clean = cleanMessage(row.userMessage);
        return clean
          ? <span className="text-text-primary text-sm truncate block">{clean.slice(0, 120)}{clean.length > 120 ? '...' : ''}</span>
          : <span className="text-text-muted italic text-sm">no message</span>;
      },
    },
    {
      key: 'toolCount',
      label: 'Tools',
      align: 'right',
      width: '4rem',
      sortable: true,
      render: (row) => row.toolCount > 0 ? fmtNumber(row.toolCount) : <span className="text-text-tertiary">&mdash;</span>,
    },
    {
      key: 'hookCount',
      label: 'Hooks',
      align: 'right',
      width: '4rem',
      sortable: true,
      render: (row) => row.hookCount > 0 ? fmtNumber(row.hookCount) : <span className="text-text-tertiary">&mdash;</span>,
    },
    {
      key: 'errorCount',
      label: 'Errors',
      align: 'right',
      width: '4rem',
      sortable: true,
      render: (row) => row.errorCount > 0
        ? <span className="text-error font-medium">{row.errorCount}</span>
        : <span className="text-text-tertiary">&mdash;</span>,
    },
    {
      key: 'tokenCount',
      label: 'Tokens',
      align: 'right',
      width: '5rem',
      sortable: true,
      render: (row) => row.tokenCount > 0 ? fmtNumber(row.tokenCount) : <span className="text-text-tertiary">&mdash;</span>,
    },
    {
      key: 'cost',
      label: 'Cost',
      align: 'right',
      width: '5rem',
      sortable: true,
      render: (row) => row.cost > 0 ? fmtCurrency(row.cost) : <span className="text-text-tertiary">&mdash;</span>,
    },
    {
      key: 'durationMs',
      label: 'Duration',
      align: 'right',
      width: '5rem',
      sortable: true,
      render: (row) => <span className={cn('font-mono text-xs', row.durationMs > 30000 ? 'text-warning' : 'text-text-muted')}>{fmtMs(row.durationMs)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/system/observability/sessions"
          className="text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          &larr; Sessions
        </Link>
        <h1 className="text-xl font-semibold text-text-primary">Session Detail</h1>
        <span className="font-mono text-xs text-text-muted">{sessionId.slice(0, 8)}</span>
        {data.project && (
          <span className="rounded-md bg-bg-tertiary px-2 py-0.5 text-xs text-text-muted">{data.project}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard label="Duration" value={fmtDuration(data.totalDurationMs)} />
        <StatCard label="Turns" value={fmtNumber(data.turns.length)} />
        <StatCard label="Tool Calls" value={fmtNumber(totalTools)} />
        <StatCard label="Hook Runs" value={fmtNumber(totalHooks)} />
        <StatCard label="Tokens" value={fmtNumber(data.totalTokens)} />
        <StatCard
          label="Cost"
          value={fmtCurrency(data.totalCost)}
          {...(errorSpans > 0 ? { detail: `${errorSpans} error${errorSpans !== 1 ? 's' : ''}`, accent: 'error' as const } : {})}
        />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-text-secondary">
          Turns ({turnRows.length})
        </h2>
        <DataTable<TurnRow>
          data={turnRows}
          columns={turnColumns}
          keyField="index"
          onRowClick={(row) => navigate(`/system/observability/sessions/${encodeURIComponent(sessionId)}/turns/${row.index}`)}
          rowClassName={(row) => row.errorCount > 0 ? 'bg-error/5' : undefined}
        />
      </div>

      {data.turns.length === 0 && (
        <p className="py-12 text-center text-sm text-text-muted">No turns found for this session</p>
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
