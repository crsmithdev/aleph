import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useObsSessionTrace } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { type TimeRange } from '../../../components/data/TimeRangeSelector';
import { fmtNumber, fmtMs, fmtCurrency, fmtToolName, cleanMessage } from '../../../utils/format';
import { cn } from '../../../utils/cn';

type Span = {
  id: string;
  kind: 'tool' | 'hook' | 'token';
  label: string;
  startMs: number;
  durationMs: number;
  isError?: boolean;
  detail?: string;
  subagentSessionId?: string;
};

type Segment = {
  id: string;
  kind: 'tool' | 'hook' | 'token' | 'agent';
  label: string;
  durationMs: number;
  widthPct: number;
  isError?: boolean;
  detail?: string;
  span?: Span;
  subagentSessionId?: string;
};

const SEGMENT_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  tool:  { bg: 'bg-accent/40',       border: 'border-accent/60',       text: 'text-text-secondary' },
  hook:  { bg: 'bg-purple-500/40',   border: 'border-purple-500/60',   text: 'text-purple-500' },
  token: { bg: 'bg-blue-500/40',     border: 'border-blue-500/60',     text: 'text-blue-500' },
  agent: { bg: 'bg-agent',              border: 'border-agent-border',      text: 'text-white' },
  error: { bg: 'bg-error/30',        border: 'border-error/60',        text: 'text-error' },
};

function buildSequence(spans: Span[], turnDurationMs: number): Segment[] {
  const totalMs = Math.max(turnDurationMs, 1);
  const sorted = [...spans].sort((a, b) => a.startMs - b.startMs);
  const segments: Segment[] = [];
  let cursor = 0;
  let gapIdx = 0;

  for (const span of sorted) {
    const gapMs = Math.max(0, span.startMs - cursor);
    if (gapMs > 0) {
      segments.push({
        id: `gap-${gapIdx++}`,
        kind: 'agent',
        label: 'LLM',
        durationMs: gapMs,
        widthPct: (gapMs / totalMs) * 100,
      });
    }
    const spanMs = Math.max(span.durationMs, 0);
    const isSubagent = span.kind === 'tool' && span.label === 'Agent';
    segments.push({
      id: span.id,
      kind: isSubagent ? 'agent' : span.kind,
      label: isSubagent ? 'Subagent' : fmtToolName(span.label),
      durationMs: spanMs,
      widthPct: Math.max((spanMs / totalMs) * 100, 0.3),
      isError: span.isError,
      detail: span.detail,
      span,
      subagentSessionId: isSubagent ? span.subagentSessionId : undefined,
    });
    cursor = Math.max(cursor, span.startMs + spanMs);
  }

  const trailingMs = Math.max(0, totalMs - cursor);
  if (trailingMs > 0) {
    segments.push({
      id: `gap-${gapIdx}`,
      kind: 'agent',
      label: 'LLM',
      durationMs: trailingMs,
      widthPct: (trailingMs / totalMs) * 100,
    });
  }

  return segments;
}

function SubagentDetail({ sessionId, range }: { sessionId: string; range: TimeRange }) {
  const { data, isLoading, error } = useObsSessionTrace(sessionId, range);

  if (isLoading) return <span className="text-xs font-mono text-text-muted">Loading subagent session...</span>;
  if (error || !data) return <span className="text-xs font-mono text-error">Failed to load subagent session</span>;

  const turnCount = data.turns.length;
  const allSpans = data.turns.flatMap((t) => t.spans);
  const toolSpans = allSpans.filter((s) => s.kind === 'tool');
  const totalCost = data.turns.reduce((sum, t) => sum + (t.cost || 0), 0);
  const toolNames = [...new Set(toolSpans.map((s) => s.label))];

  return (
    <div className="space-y-1 text-xs font-mono">
      <div>
        <span className="text-text-muted">Subagent Session: </span>
        <Link
          to={`/observability/sessions/${encodeURIComponent(sessionId)}`}
          className="text-accent hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {sessionId.slice(0, 16)}...
        </Link>
      </div>
      <div className="text-text-secondary">
        Turns: {turnCount} | Tools: {toolSpans.length} | Cost: {fmtCurrency(totalCost)}
      </div>
      {toolNames.length > 0 && (
        <div className="text-text-muted">
          Tools used: {toolNames.join(', ')}
        </div>
      )}
    </div>
  );
}

function cleanDetail(detail: string): string {
  return detail
    .replace(/^(command|description|file_path|content|pattern|query|url|path|prompt|message):\s*/gmi, '')
    .trim();
}

export function TurnTracePage() {
  const { id: rawId, turnIndex: rawTurnIndex } = useParams<{ id: string; turnIndex: string }>();
  const sessionId = decodeURIComponent(rawId ?? '');
  const turnIndex = parseInt(rawTurnIndex ?? '0', 10);
  const [range] = useState<TimeRange>('30d');
  const [selectedSpan, setSelectedSpan] = useState<string | null>(null);
  const [showInternal, setShowInternal] = useState(true);
  const { data, isLoading, error, refetch } = useObsSessionTrace(sessionId, range);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load turn trace" retry={refetch} />;

  const turn = data.turns.find((t) => t.index === turnIndex);
  if (!turn) return <ErrorState message={`Turn #${turnIndex + 1} not found`} retry={refetch} />;

  const toolSpans = turn.spans.filter((s) => s.kind === 'tool');
  const hookSpans = turn.spans.filter((s) => s.kind === 'hook');
  const errorCount = turn.spans.filter((s) => s.isError).length;
  const prevTurn = turnIndex > 0 ? turnIndex - 1 : null;
  const nextTurn = turnIndex < data.turns.length - 1 ? turnIndex + 1 : null;
  const cleanMsg = cleanMessage(turn.userMessage);

  const allSegments = buildSequence(turn.spans, turn.durationMs);
  const internalMs = allSegments.filter((s) => s.kind === 'agent').reduce((sum, s) => sum + s.durationMs, 0);
  const internalPct = turn.durationMs > 0 ? Math.round((internalMs / turn.durationMs) * 100) : 0;

  const visibleSegments = showInternal ? allSegments : allSegments.filter((s) => s.kind !== 'agent');
  const visibleTotalMs = visibleSegments.reduce((sum, s) => sum + s.durationMs, 0);
  const segments = visibleSegments.map((s) => ({
    ...s,
    widthPct: visibleTotalMs > 0
      ? (s.durationMs / visibleTotalMs) * 100
      : 100 / visibleSegments.length,
  }));
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to={`/observability/sessions/${encodeURIComponent(sessionId)}`}
          className="text-xl text-text-muted hover:text-text-primary transition-colors"
        >
          &lsaquo;
        </Link>
        <h1 className="text-xl font-semibold text-text-primary">Turn #{turnIndex + 1}</h1>
        <div className="flex items-center gap-1 ml-auto">
          {prevTurn !== null && (
            <Link
              to={`/observability/sessions/${encodeURIComponent(sessionId)}/turns/${prevTurn}`}
              className="px-2 py-1 text-xs text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors"
            >
              &larr; Prev
            </Link>
          )}
          <span className="text-xs text-text-muted px-2">{turnIndex + 1} / {data.turns.length}</span>
          {nextTurn !== null && (
            <Link
              to={`/observability/sessions/${encodeURIComponent(sessionId)}/turns/${nextTurn}`}
              className="px-2 py-1 text-xs text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors"
            >
              Next &rarr;
            </Link>
          )}
        </div>
      </div>

      {cleanMsg && (
        <div className="rounded-lg border border-border-primary bg-bg-secondary/50 px-4 py-3">
          <pre className="text-sm font-mono text-text-primary whitespace-pre-wrap break-words">{cleanMsg.slice(0, 500)}{cleanMsg.length > 500 ? '...' : ''}</pre>
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

      {/* Legend */}
      <div className="flex items-center gap-5 text-xs text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2.5 rounded-sm bg-accent/40 border border-accent/60" /> Tool
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2.5 rounded-sm bg-purple-500/40 border border-purple-500/60" /> Hook
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2.5 rounded-sm bg-error/30 border border-error/60" /> Error
        </span>
        <button
          onClick={() => setShowInternal(!showInternal)}
          className={cn(
            'flex items-center gap-1.5 rounded px-1.5 py-0.5 border transition-colors',
            showInternal
              ? 'border-border-primary bg-bg-secondary text-text-muted'
              : 'border-accent/40 bg-accent/10 text-accent',
          )}
        >
          <span className="inline-block w-3 h-2.5 rounded-sm bg-agent border border-agent-border" /> Internal
          <span className="text-text-disabled">({internalPct}%)</span>
        </button>
        {turn.model && (
          <span className="ml-auto font-mono">{turn.model}</span>
        )}
        <span className={cn(!turn.model && 'ml-auto', 'text-text-disabled font-mono')}>
          {showInternal ? fmtMs(turn.durationMs) : fmtMs(turn.durationMs - internalMs)} {showInternal ? 'total' : 'active'}
        </span>
      </div>

      {/* Sequence bar */}
      <div className="rounded-lg border border-border-primary bg-bg-primary overflow-hidden">
        <div className="px-4 py-4">
          <div className="flex w-full h-10 rounded-md overflow-hidden border border-border-primary/30 items-stretch">
            {segments.map((seg) => {
              const styles = seg.isError ? SEGMENT_STYLES.error : SEGMENT_STYLES[seg.kind];
              const isSelected = selectedSpan === seg.id;
              const isClickable = seg.kind !== 'agent';
              const showLabel = seg.widthPct > 6;
              const showDuration = seg.widthPct > 4;

              return (
                <div
                  key={seg.id}
                  className={cn(
                    'relative flex flex-col items-center justify-center overflow-hidden transition-all border-r border-bg-primary/50',
                    styles.bg,
                    isSelected && 'ring-2 ring-accent ring-inset z-10',
                    isClickable && 'cursor-pointer hover:brightness-125',
                  )}
                  style={{ width: `${seg.widthPct}%`, minWidth: seg.kind !== 'agent' ? '3px' : undefined }}
                  onClick={isClickable ? () => setSelectedSpan(isSelected ? null : seg.id) : undefined}
                  title={`${seg.label}: ${fmtMs(seg.durationMs)}`}
                >
                  {showLabel && (
                    <span className={cn('text-[10px] font-mono truncate px-0.5 leading-tight', styles.text)}>
                      {seg.label}
                    </span>
                  )}
                  {showDuration && (
                    <span className={cn('text-[9px] font-mono leading-tight', seg.kind === 'agent' ? 'text-white/70' : 'text-text-muted/70')}>
                      {fmtMs(seg.durationMs)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Event table */}
      {(() => {
        const eventSegments = showInternal ? segments : segments.filter((s) => s.kind !== 'agent');
        return (
          <div className="rounded-lg border border-border-primary bg-bg-primary overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-primary text-[11px] font-medium uppercase tracking-wider text-text-muted">
                  <th className="py-2 pl-4 pr-2 text-right w-10">#</th>
                  <th className="py-2 px-2 text-left w-16">Type</th>
                  <th className="py-2 px-2 text-left">Name</th>
                  <th className="py-2 px-2 text-right w-16">Start</th>
                  <th className="py-2 px-2 text-right w-16">Time</th>
                  <th className="py-2 px-2 text-right w-12">%</th>
                  <th className="py-2 pr-4 pl-2 text-right w-8"></th>
                </tr>
              </thead>
              <tbody>
                {eventSegments.map((seg, i) => {
                  const styles = seg.isError ? SEGMENT_STYLES.error : SEGMENT_STYLES[seg.kind];
                  const isSelected = selectedSpan === seg.id;
                  const pct = turn.durationMs > 0 ? (seg.durationMs / turn.durationMs) * 100 : 0;

                  return (
                    <React.Fragment key={seg.id}>
                    <tr
                      className={cn(
                        'group cursor-pointer transition-colors border-b border-border-primary/40 last:border-b-0',
                        isSelected ? 'bg-bg-tertiary' : 'hover:bg-bg-secondary/40',
                      )}
                      onClick={() => setSelectedSpan(isSelected ? null : seg.id)}
                    >
                      <td className="px-4 py-2.5 text-right font-mono text-[11px] text-text-disabled align-top">
                        {i + 1}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <span className={cn(
                          'inline-flex items-center px-1.5 py-px rounded text-[10px] font-semibold uppercase tracking-wide leading-tight',
                          styles.bg, 'border', styles.border, styles.text,
                        )}>
                          {seg.kind}
                        </span>
                      </td>
                      <td className={cn(
                        'px-4 py-2.5 font-mono text-xs truncate max-w-0 align-top',
                        seg.isError ? 'text-error' : 'text-text-primary',
                      )}>
                        {seg.subagentSessionId ? (
                          <Link
                            to={`/observability/sessions/${encodeURIComponent(seg.subagentSessionId)}`}
                            className="text-accent hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {seg.label}
                          </Link>
                        ) : seg.label}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-text-disabled align-top">
                        {seg.span ? fmtMs(seg.span.startMs) : '—'}
                      </td>
                      <td className={cn(
                        'px-4 py-2.5 text-right font-mono text-xs align-top',
                        seg.durationMs === 0 ? 'text-text-disabled' : 'text-text-primary',
                      )}>
                        {fmtMs(seg.durationMs)}
                      </td>
                      <td className={cn(
                        'px-4 py-2.5 text-right font-mono text-[11px] align-top',
                        pct < 1 ? 'text-text-disabled' : pct > 50 ? 'text-accent' : 'text-text-muted',
                      )}>
                        {pct < 0.1 ? '<0.1' : pct.toFixed(1)}
                      </td>
                      <td className="px-4 py-2.5 pr-4 text-right align-top">
                        {(seg.detail || seg.subagentSessionId) && (
                          <span className={cn(
                            'inline-block text-[10px] text-text-disabled transition-transform',
                            isSelected && 'rotate-90',
                          )}>
                            ▸
                          </span>
                        )}
                      </td>
                    </tr>
                    {isSelected && (seg.detail || seg.subagentSessionId) && (
                      <tr className="bg-bg-tertiary">
                        <td colSpan={7} className="px-4 pb-3 pt-0">
                          {seg.subagentSessionId && (
                            <div className="p-3 rounded bg-bg-secondary border border-border-primary/30 mb-2">
                              <SubagentDetail sessionId={seg.subagentSessionId} range={range} />
                            </div>
                          )}
                          {seg.detail && (
                            <pre className="p-3 rounded bg-bg-secondary text-xs font-mono text-text-secondary whitespace-pre-wrap break-all max-h-60 overflow-auto border border-border-primary/30">
                              {cleanDetail(seg.detail)}
                            </pre>
                          )}
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* Empty state */}
      {turn.spans.length === 0 && (
        <div className="rounded-lg border border-border-primary bg-bg-primary overflow-hidden">
          <div className="px-4 py-4">
            <div className="flex w-full h-10 rounded-md overflow-hidden border border-border-primary/30">
              <div
                className="relative flex items-center justify-center w-full bg-text-muted/8"
                title={`LLM: ${fmtMs(turn.durationMs)}`}
              >
                <span className="text-[10px] font-mono text-text-muted">
                  LLM — {fmtMs(turn.durationMs)}
                </span>
              </div>
            </div>
            <p className="mt-3 text-center text-xs text-text-muted">No tool or hook spans in this turn</p>
          </div>
        </div>
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
