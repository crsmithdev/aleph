import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useObsSessionTrace } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { type TimeRange } from '../../../components/data/TimeRangeSelector';
import { fmtNumber, fmtMs, fmtCurrency, dateTime, fmtDuration, cleanMessage } from '../../../utils/format';
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
  hasSubagent: boolean;
  hasTools: boolean;
};

export function SessionTracePage() {
  const { id: rawId } = useParams<{ id: string }>();
  const sessionId = decodeURIComponent(rawId ?? '');
  const navigate = useNavigate();
  const [range] = useState<TimeRange>('30d');
  const [toolOnly, setToolOnly] = useState(false);
  const [subagentOnly, setSubagentOnly] = useState(false);
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
    hasSubagent: t.spans.some((s) => s.kind === 'tool' && s.label === 'Agent'),
    hasTools: t.spans.some((s) => s.kind === 'tool'),
  }));
  const subagentTurnCount = turnRows.filter((r) => r.hasSubagent).length;
  const toolTurnCount = turnRows.filter((r) => r.hasTools).length;
  let filteredRows = turnRows;
  if (toolOnly) filteredRows = filteredRows.filter((r) => r.hasTools);
  if (subagentOnly) filteredRows = filteredRows.filter((r) => r.hasSubagent);

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
      label: 'Turn',
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
      render: (row) => row.toolCount > 0 ? fmtNumber(row.toolCount) : <span className="text-text-tertiary">&mdash;</span>,
    },
    {
      key: 'hookCount',
      label: 'Hooks',
      align: 'right',
      width: '4rem',
      render: (row) => row.hookCount > 0 ? fmtNumber(row.hookCount) : <span className="text-text-tertiary">&mdash;</span>,
    },
    {
      key: 'errorCount',
      label: 'Errors',
      align: 'right',
      width: '4rem',
      render: (row) => row.errorCount > 0
        ? <span className="text-error font-medium">{row.errorCount}</span>
        : <span className="text-text-tertiary">&mdash;</span>,
    },
    {
      key: 'tokenCount',
      label: 'Tokens',
      align: 'right',
      width: '5rem',
      render: (row) => row.tokenCount > 0 ? fmtNumber(row.tokenCount) : <span className="text-text-tertiary">&mdash;</span>,
    },
    {
      key: 'cost',
      label: 'Cost',
      align: 'right',
      width: '5rem',
      render: (row) => row.cost > 0 ? fmtCurrency(row.cost) : <span className="text-text-tertiary">&mdash;</span>,
    },
    {
      key: 'durationMs',
      label: 'Duration',
      align: 'right',
      width: '5rem',
      render: (row) => <span className={cn('font-mono text-xs', row.durationMs > 30000 ? 'text-warning' : 'text-text-muted')}>{fmtMs(row.durationMs)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/observability/sessions"
          className="text-xl text-text-muted hover:text-text-primary transition-colors"
        >
          &laquo;
        </Link>
        <h1 className="text-xl font-semibold text-text-primary">
          Session <span className="font-mono text-xl text-accent">{sessionId.slice(0, 8)}</span>
        </h1>
        {data.project && (
          <span className="rounded-md bg-bg-tertiary px-2 py-0.5 text-xs text-text-muted">{data.project}</span>
        )}
        {data.parentSessionId && (
          <Link
            to={`/observability/sessions/${encodeURIComponent(data.parentSessionId)}`}
            className="text-xs text-accent hover:underline"
          >
            Parent session &rarr;
          </Link>
        )}
        {data.gateInfo?.mode === 'inline' && (
          <span className="rounded-md bg-yellow-500/15 px-2 py-0.5 text-xs font-medium text-yellow-400 border border-yellow-500/30">
            inline
          </span>
        )}
        {data.gateInfo?.mode === 'dispatched' && (
          <span className="rounded-md bg-purple-500/15 px-2 py-0.5 text-xs font-medium text-purple-400 border border-purple-500/30">
            dispatched
          </span>
        )}
        {data.gateInfo && data.gateInfo.dispatchBlocks > 0 && (
          <span className="text-xs text-text-muted">
            {data.gateInfo.dispatchBlocks} block{data.gateInfo.dispatchBlocks !== 1 ? 's' : ''}
          </span>
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
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-sm font-medium text-text-secondary">
            Turns ({filteredRows.length !== turnRows.length ? `${filteredRows.length} / ` : ''}{turnRows.length})
          </h2>
          {toolTurnCount < turnRows.length && (
            <button
              onClick={() => setToolOnly(!toolOnly)}
              className={cn(
                'flex items-center gap-1.5 rounded px-2 py-1 text-xs border transition-colors',
                toolOnly
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border-primary bg-bg-secondary text-text-muted',
              )}
            >
              Tool
              <span className="text-text-disabled">({toolTurnCount})</span>
            </button>
          )}
          {subagentTurnCount > 0 && (
            <button
              onClick={() => setSubagentOnly(!subagentOnly)}
              className={cn(
                'flex items-center gap-1.5 rounded px-2 py-1 text-xs border transition-colors',
                subagentOnly
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border-primary bg-bg-secondary text-text-muted',
              )}
            >
              Subagent
              <span className="text-text-disabled">({subagentTurnCount})</span>
            </button>
          )}
        </div>
        <DataTable<TurnRow>
          data={filteredRows}
          columns={turnColumns}
          keyField="index"
          onRowClick={(row) => navigate(`/observability/sessions/${encodeURIComponent(sessionId)}/turns/${row.index}`)}
          rowClassName={(row) => row.errorCount > 0 ? 'bg-error/5' : row.hasSubagent ? 'bg-accent/5' : undefined}
        />
      </div>

      {data.turns.length === 0 && (
        <p className="py-12 text-center text-sm text-text-muted">No turns found for this session</p>
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
