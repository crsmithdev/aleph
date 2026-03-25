import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useObsSessionTrace } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { type TimeRange } from '../../../components/data/TimeRangeSelector';
import { fmtNumber, fmtMs, fmtCurrency } from '../../../utils/format';
import { cn } from '../../../utils/cn';

type Span = {
  id: string;
  kind: 'tool' | 'hook' | 'token';
  label: string;
  startMs: number;
  durationMs: number;
  isError?: boolean;
  detail?: string;
};

const SPAN_COLORS: Record<string, { bg: string; border: string }> = {
  tool: { bg: 'bg-accent/30', border: 'border-accent' },
  hook: { bg: 'bg-purple-500/30', border: 'border-purple-500' },
  token: { bg: 'bg-blue-500/30', border: 'border-blue-500' },
};

function SpanBar({ span, turnDurationMs, selected, onSelect }: {
  span: Span;
  turnDurationMs: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const maxMs = Math.max(turnDurationMs, 1);
  const leftPct = (span.startMs / maxMs) * 100;
  const widthPct = Math.max((span.durationMs / maxMs) * 100, 0.5);
  const colors = SPAN_COLORS[span.kind] || SPAN_COLORS.tool;

  return (
    <div
      className={cn(
        'group relative flex items-center h-8 cursor-pointer rounded transition-colors',
        selected ? 'bg-bg-tertiary' : 'hover:bg-bg-secondary/30',
      )}
      onClick={onSelect}
    >
      <div className="w-48 shrink-0 pr-3 text-right">
        <span className={cn(
          'font-mono text-xs truncate inline-block max-w-full',
          span.isError ? 'text-error' : 'text-text-secondary',
        )}>
          {span.label}
        </span>
      </div>
      <div className="relative flex-1 h-5">
        <div
          className={cn(
            'absolute top-0 h-full rounded-sm border-l-2',
            colors.bg,
            colors.border,
            span.isError && 'bg-error/20 border-error',
          )}
          style={{
            left: `${Math.min(leftPct, 99)}%`,
            width: `${Math.min(widthPct, 100 - leftPct)}%`,
            minWidth: '3px',
          }}
        />
        <span
          className="absolute top-1 text-[10px] font-mono text-text-muted"
          style={{ left: `${Math.min(leftPct + widthPct + 0.3, 96)}%` }}
        >
          {span.durationMs > 0 ? fmtMs(span.durationMs) : ''}
        </span>
      </div>
    </div>
  );
}

function TimeAxis({ durationMs }: { durationMs: number }) {
  if (durationMs <= 0) return null;
  const ticks = 8;
  const step = durationMs / ticks;

  return (
    <div className="flex items-center h-6 ml-48 mb-1 border-b border-border-primary/30">
      <div className="relative flex-1">
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const ms = Math.round(i * step);
          const pct = (i / ticks) * 100;
          return (
            <span
              key={i}
              className="absolute text-[10px] font-mono text-text-muted -translate-x-1/2"
              style={{ left: `${pct}%` }}
            >
              {ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function cleanMessage(msg: string): string {
  return msg
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function TurnTracePage() {
  const { id: rawId, turnIndex: rawTurnIndex } = useParams<{ id: string; turnIndex: string }>();
  const sessionId = decodeURIComponent(rawId ?? '');
  const turnIndex = parseInt(rawTurnIndex ?? '0', 10);
  const [range] = useState<TimeRange>('30d');
  const [selectedSpan, setSelectedSpan] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useObsSessionTrace(sessionId, range);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load turn trace" retry={refetch} />;

  const turn = data.turns.find((t) => t.index === turnIndex);
  if (!turn) return <ErrorState message={`Turn #${turnIndex + 1} not found`} retry={refetch} />;

  const toolSpans = turn.spans.filter((s) => s.kind === 'tool');
  const hookSpans = turn.spans.filter((s) => s.kind === 'hook');
  const errorCount = turn.spans.filter((s) => s.isError).length;
  const selected = turn.spans.find((s) => s.id === selectedSpan);
  const prevTurn = turnIndex > 0 ? turnIndex - 1 : null;
  const nextTurn = turnIndex < data.turns.length - 1 ? turnIndex + 1 : null;
  const cleanMsg = cleanMessage(turn.userMessage);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to={`/system/observability/sessions/${encodeURIComponent(sessionId)}`}
          className="text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          &larr; Session {sessionId.slice(0, 8)}
        </Link>
        <h1 className="text-xl font-semibold text-text-primary">Turn #{turnIndex + 1}</h1>
        <div className="flex items-center gap-1 ml-auto">
          {prevTurn !== null && (
            <Link
              to={`/system/observability/sessions/${encodeURIComponent(sessionId)}/turns/${prevTurn}`}
              className="px-2 py-1 text-xs text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors"
            >
              &larr; Prev
            </Link>
          )}
          <span className="text-xs text-text-muted px-2">{turnIndex + 1} / {data.turns.length}</span>
          {nextTurn !== null && (
            <Link
              to={`/system/observability/sessions/${encodeURIComponent(sessionId)}/turns/${nextTurn}`}
              className="px-2 py-1 text-xs text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors"
            >
              Next &rarr;
            </Link>
          )}
        </div>
      </div>

      {cleanMsg && (
        <div className="rounded-lg border border-border-primary bg-bg-secondary/50 px-4 py-3">
          <p className="text-sm text-text-primary">{cleanMsg.slice(0, 500)}{cleanMsg.length > 500 ? '...' : ''}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard label="Duration" value={fmtMs(turn.durationMs)} />
        <StatCard label="Tool Calls" value={fmtNumber(toolSpans.length)} />
        <StatCard label="Hook Runs" value={fmtNumber(hookSpans.length)} />
        <StatCard label="Tokens" value={fmtNumber(turn.tokenCount || 0)} />
        <StatCard label="Cost" value={fmtCurrency(turn.cost || 0)} />
        <StatCard
          label="Errors"
          value={String(errorCount)}
          accent={errorCount > 0 ? 'error' : 'default'}
        />
      </div>

      <div className="flex items-center gap-6 text-xs text-text-muted">
        <span>Legend:</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm bg-accent/30 border-l-2 border-accent" /> Tool
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm bg-purple-500/30 border-l-2 border-purple-500" /> Hook
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm bg-error/20 border-l-2 border-error" /> Error
        </span>
        {turn.model && (
          <span className="ml-auto font-mono">{turn.model}</span>
        )}
      </div>

      {turn.spans.length > 0 ? (
        <div className="rounded-lg border border-border-primary bg-bg-primary overflow-hidden">
          <div className="px-4 py-3 space-y-0">
            <TimeAxis durationMs={turn.durationMs} />
            {turn.spans.map((span) => (
              <SpanBar
                key={span.id}
                span={span}
                turnDurationMs={turn.durationMs}
                selected={selectedSpan === span.id}
                onSelect={() => setSelectedSpan(selectedSpan === span.id ? null : span.id)}
              />
            ))}
          </div>
          {selected?.detail && (
            <div className="border-t border-border-primary/50 px-4 py-3">
              <div className="ml-48 p-3 rounded bg-bg-secondary text-xs font-mono text-text-secondary whitespace-pre-wrap break-all max-h-60 overflow-auto">
                {selected.detail}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border-primary bg-bg-primary px-4 py-12 text-center text-sm text-text-muted">
          No tool or hook spans in this turn
        </div>
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
