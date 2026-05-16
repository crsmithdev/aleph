import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useObsLearningLoop,
  useObsLearningFeedback,
  useObsGateEvents,
  useObsGatePatterns,
  useObsGatePatternEvents,
  useObsMemoryUsage,
} from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { type Granularity, type TimeRange } from '../../../components/data/TimeRangeSelector';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { Icon } from '../../../components/ui/Icon';
import { fmtNumber, fmtPct, compactTs } from '../../../utils/format';
import { clsx } from 'clsx';

type LoopItem = {
  ts: string;
  sessionId: string;
  memoryId?: string;
  type: string;
  source: string;
  insight: string;
  content: string;
  tags: string;
};

type FeedbackItem = {
  ts: string;
  sessionId: string;
  trigger: string;
  rating: number;
  type: 'sentiment' | 'numeric';
  priorText?: string;
  priorTools?: string[];
  priorFiles?: string[];
  turnIndex?: number;
};

type GateEvent = {
  ts: string;
  sessionId: string;
  hook: string;
  decision: 'pass' | 'block' | 'skip' | 'advisory';
  reason: string;
  editedFiles: string[];
  verifyPresent?: boolean;
  verifyMissing?: string[];
  verify?: Record<string, string | null>;
};

type GatePattern = {
  hook: string;
  filePrefix: string;
  decision: 'block' | 'skip' | 'advisory';
  count: number;
  sessionIds: string[];
  lastSeen: string;
  representativeReason: string;
  representativeFiles: string[];
};

type CorrectionGroup = {
  trigger: string;
  count: number;
  lastTs: string;
  items: FeedbackItem[];
};

/** Strip /home/<username>/ prefix from file paths for compact display. */
function shortenPath(p: string): string {
  return p.replace(/^\/home\/[^/]+\//, '~/');
}

/** Parse a string of space-separated key=value tokens into pairs, or return null if it doesn't look like key=value. */
function parseKeyValues(text: string): Array<{ key: string; value: string }> | null {
  const tokens = text.trim().split(/\s+/);
  const pairs = tokens.map(t => {
    const eq = t.indexOf('=');
    if (eq < 1) return null;
    return { key: t.slice(0, eq), value: t.slice(eq + 1) };
  });
  if (pairs.some(p => p === null)) return null;
  return pairs as Array<{ key: string; value: string }>;
}

/** Unified Details cell renderer for gate events — consistent mono key: value style. */
function GateDetailsCell({ row }: { row: GateEvent }) {
  // Build structured pairs from verify metadata first
  const verifyParts: Array<{ key: string; value: string }> = [];
  if (row.verifyPresent) verifyParts.push({ key: 'verify', value: 'present' });
  if (row.verifyMissing?.length) verifyParts.push({ key: 'missing', value: row.verifyMissing.join(', ') });
  if (row.verify) Object.entries(row.verify).forEach(([k, v]) => verifyParts.push({ key: k, value: v ?? 'null' }));

  // If no verify metadata, try to parse the reason as key=value
  const parts = verifyParts.length > 0 ? verifyParts : (parseKeyValues(row.reason) ?? null);

  if (parts && parts.length > 0) {
    return (
      <span className="font-mono text-xs flex flex-wrap gap-x-3 gap-y-0.5">
        {parts.slice(0, 4).map(({ key, value }, i) => (
          <span key={i} className="whitespace-nowrap">
            <span className="text-text-muted">{key}</span>
            <span className="text-text-disabled">: </span>
            <span className="text-text-secondary">{value.length > 32 ? value.slice(0, 32) + '…' : value}</span>
          </span>
        ))}
        {parts.length > 4 && <span className="text-text-disabled">+{parts.length - 4}</span>}
      </span>
    );
  }

  return (
    <span className="font-mono text-text-muted text-xs" title={row.reason}>
      {row.reason.slice(0, 120)}{row.reason.length > 120 && '…'}
    </span>
  );
}

function loopTypeBadge(type: string) {
  const map: Record<string, string> = {
    correction: 'bg-red-500/15 text-red-400',
    validated: 'bg-green-500/15 text-green-400',
    friction: 'bg-yellow-500/15 text-yellow-400',
    session: 'bg-sky-500/15 text-sky-400',
    error: 'bg-orange-500/15 text-orange-400',
  };
  return map[type] ?? 'bg-bg-tertiary text-text-secondary';
}

function decisionBadgeClass(decision: string) {
  const map: Record<string, string> = {
    pass: 'bg-green-500/15 text-green-400',
    block: 'bg-red-500/15 text-red-400',
    skip: 'bg-bg-tertiary text-text-secondary',
    advisory: 'bg-yellow-500/15 text-yellow-400',
  };
  return map[decision] ?? 'bg-bg-tertiary text-text-secondary';
}

function decisionCalloutColor(decision: string): string {
  const map: Record<string, string> = {
    block: 'var(--error)',
    advisory: 'var(--warning)',
    skip: 'var(--text-disabled)',
  };
  return map[decision] ?? 'var(--text-disabled)';
}

function SessionLink({ sessionId, turnIndex }: { sessionId: string; turnIndex?: number }) {
  const path = turnIndex !== undefined
    ? `/observability/sessions/${sessionId}/turns/${turnIndex}`
    : `/observability/sessions/${sessionId}`;
  return (
    <Link
      to={path}
      className="font-mono text-text-muted text-xs hover:text-accent transition-colors"
    >
      {sessionId.slice(0, 8)}
    </Link>
  );
}

/** Signal badge — ▲/▼/~ with numeric score, colored by classification. */
function SignalBadge({ rating }: { rating: number }) {
  if (rating >= 7) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-green-500/15 text-green-400">
        ▲ {rating}/10
      </span>
    );
  }
  if (rating <= 3) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-red-500/15 text-red-400">
        ▼ {rating}/10
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-yellow-500/15 text-yellow-400">
      ~ {rating}/10
    </span>
  );
}

function PatternEventsTable({ pattern }: { pattern: GatePattern }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const { data, isLoading } = useObsGatePatternEvents(pattern.hook, pattern.decision, pattern.filePrefix);

  if (isLoading) return <PageLoading />;
  const matched = (data?.events ?? []) as GateEvent[];

  const columns: Column<GateEvent>[] = [
    {
      key: 'ts',
      label: 'Time',
      width: '140px',
      render: (row) => (
        <span className="font-mono text-text-secondary whitespace-nowrap text-xs">{compactTs(row.ts)}</span>
      ),
    },
    {
      key: 'hook',
      label: 'Hook',
      width: '180px',
      render: (row) => <span className="font-mono text-text-primary text-xs">{row.hook}</span>,
    },
    {
      key: 'decision',
      label: 'Decision',
      width: '90px',
      render: (row) => (
        <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold', decisionBadgeClass(row.decision))}>
          {row.decision}
        </span>
      ),
    },
    {
      key: 'editedFiles',
      label: 'Files',
      width: '300px',
      render: (row) => {
        if (!row.editedFiles || row.editedFiles.length === 0) return <span className="text-text-disabled">—</span>;
        const short = row.editedFiles.map(shortenPath);
        return (
          <span className="font-mono text-text-muted text-xs" title={row.editedFiles.join(', ')}>
            {short.slice(0, 2).join(', ')}
            {short.length > 2 && ` +${short.length - 2}`}
          </span>
        );
      },
    },
    {
      key: 'reason',
      label: 'Details',
      render: (row) => <GateDetailsCell row={row} />,
    },
    {
      key: 'sessionId',
      label: 'Session',
      width: '80px',
      render: (row) => <SessionLink sessionId={row.sessionId} />,
    },
  ];

  if (matched.length === 0) {
    return <p className="text-xs text-text-disabled px-1">No matching events found.</p>;
  }

  return (
    <DataTable<GateEvent>
      data={matched}
      columns={columns}
      keyField="ts"
      maxRows={100}
      pageSize={25}
      expandedKey={expandedKey}
      onExpandToggle={setExpandedKey}
      renderExpanded={(row) => (
        <div className="px-4 py-3 space-y-2 bg-bg-tertiary/50 text-sm">
          {row.reason && (
            <div>
              <span className="text-text-muted font-medium">Reason: </span>
              <span className="text-text-secondary">{row.reason}</span>
            </div>
          )}
          {row.editedFiles && row.editedFiles.length > 0 && (
            <div>
              <span className="text-text-muted font-medium">Files: </span>
              <span className="font-mono text-text-secondary">{row.editedFiles.join(', ')}</span>
            </div>
          )}
          {row.verify && Object.keys(row.verify).length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span className="text-text-muted font-medium">Verify:</span>
              {Object.entries(row.verify).map(([k, v]) => (
                <span key={k} className="font-mono">
                  <span className="text-text-muted">{k}</span>
                  <span className="text-text-disabled">=</span>
                  <span className="text-text-secondary">{v ?? 'null'}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      rowKeyFn={(row) => row.ts + row.sessionId}
    />
  );
}

function GatesSection() {
  const { data: eventsData, isLoading: eventsLoading, error: eventsError, refetch: eventsRefetch } = useObsGateEvents();
  const { data: patternsData, isLoading: patternsLoading } = useObsGatePatterns();
  const [decisionFilter, setDecisionFilter] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [patternExpandedKey, setPatternExpandedKey] = useState<string | null>(null);

  if (eventsLoading || patternsLoading) return <PageLoading />;
  if (eventsError || !eventsData) return <ErrorState message="Failed to load gate events" retry={eventsRefetch} />;

  const FILTERS = [
    { key: null, label: 'All' },
    { key: 'pass', label: 'Pass' },
    { key: 'block', label: 'Block' },
    { key: 'skip', label: 'Skip' },
    { key: 'advisory', label: 'Advisory' },
  ];

  const filtered = decisionFilter
    ? eventsData.events.filter((e: GateEvent) => e.decision === decisionFilter)
    : eventsData.events;


  const eventColumns: Column<GateEvent>[] = [
    {
      key: 'ts',
      label: 'Time',
      width: '140px',
      render: (row) => (
        <span className="font-mono text-text-secondary whitespace-nowrap text-xs">{compactTs(row.ts)}</span>
      ),
    },
    {
      key: 'hook',
      label: 'Hook',
      width: '180px',
      render: (row) => <span className="font-mono text-text-primary text-xs">{row.hook}</span>,
    },
    {
      key: 'decision',
      label: 'Decision',
      width: '90px',
      render: (row) => (
        <span
          className={clsx(
            'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold',
            decisionBadgeClass(row.decision),
          )}
        >
          {row.decision}
        </span>
      ),
    },
    {
      key: 'editedFiles',
      label: 'Files',
      width: '300px',
      render: (row) => {
        if (!row.editedFiles || row.editedFiles.length === 0) {
          return <span className="text-text-disabled">—</span>;
        }
        const short = row.editedFiles.map(shortenPath);
        return (
          <span className="font-mono text-text-muted text-xs" title={row.editedFiles.join(', ')}>
            {short.slice(0, 2).join(', ')}
            {short.length > 2 && ` +${short.length - 2}`}
          </span>
        );
      },
    },
    {
      key: 'reason',
      label: 'Details',
      render: (row) => <GateDetailsCell row={row} />,
    },
    {
      key: 'sessionId',
      label: 'Session',
      width: '80px',
      render: (row) => <SessionLink sessionId={row.sessionId} />,
    },
  ];

  const patterns: GatePattern[] = patternsData?.patterns ?? [];

  return (
    <div className="space-y-6">
      {/* Patterns — stat-callout panels */}
      {patterns.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-heading text-sm font-medium text-text-muted uppercase tracking-wide">Patterns</h3>
          <div className="space-y-1.5">
            {patterns.map((pattern) => {
              const rowKey = pattern.hook + pattern.decision + pattern.filePrefix;
              const isOpen = patternExpandedKey === rowKey;
              const color = decisionCalloutColor(pattern.decision);
              return (
                <div key={rowKey} className="rounded-lg border border-border-primary overflow-hidden bg-bg-secondary">
                  <button
                    type="button"
                    onClick={() => setPatternExpandedKey(isOpen ? null : rowKey)}
                    className="w-full flex items-stretch text-left transition-colors hover:bg-bg-tertiary/50"
                  >
                    {/* Left callout */}
                    <div
                      className="flex flex-col items-center justify-center px-4 py-3 bg-bg-contrast border-r border-border-primary shrink-0 min-w-[68px]"
                      style={{ borderLeft: `3px solid ${color}` }}
                    >
                      <span className="font-mono text-lg font-bold leading-none" style={{ color }}>
                        {fmtNumber(pattern.count)}
                      </span>
                      <span className="text-[10px] text-text-disabled mt-0.5 uppercase tracking-wide">events</span>
                    </div>
                    {/* Content */}
                    <div className="flex items-center gap-3 flex-1 px-4 py-3 flex-wrap min-w-0">
                      <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold shrink-0', decisionBadgeClass(pattern.decision))}>
                        {pattern.decision}
                      </span>
                      <span className="font-mono text-text-primary text-xs">{pattern.hook}</span>
                      <span className="text-text-disabled text-xs shrink-0">{fmtNumber(pattern.sessionIds.length)} sessions</span>
                      {pattern.filePrefix
                        ? <span className="font-mono text-text-muted text-xs">{shortenPath(pattern.filePrefix)}</span>
                        : <span className="text-text-disabled text-xs">no scope</span>
                      }
                      <span className="text-text-disabled text-xs shrink-0">{compactTs(pattern.lastSeen)}</span>
                    </div>
                    {/* Chevron */}
                    <div className={clsx('flex items-center px-3 text-text-disabled transition-transform shrink-0', isOpen && 'rotate-90')}>
                      <Icon name="chevron_right" className="text-[18px]" />
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-border-primary bg-bg-contrast">
                      <PatternEventsTable pattern={pattern} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Events table */}
      <div className="space-y-3">
        <h3 className="font-heading text-sm font-medium text-text-muted uppercase tracking-wide">Events</h3>

        {/* Filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map(({ key, label }) => (
            <button
              key={label}
              onClick={() => setDecisionFilter(key)}
              className={clsx(
                'px-3 py-1 text-xs rounded-full border transition-colors',
                decisionFilter === key
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border-primary text-text-muted hover:border-accent/50 hover:text-text-secondary',
              )}
            >
              {label}
              {key === null && ` (${fmtNumber(eventsData.total)})`}
              {key === 'pass' && ` (${fmtNumber(eventsData.passCount)})`}
              {key === 'block' && ` (${fmtNumber(eventsData.blockCount)})`}
              {key === 'skip' && ` (${fmtNumber(eventsData.skipCount)})`}
              {key === 'advisory' && ` (${fmtNumber(eventsData.advisoryCount)})`}
            </button>
          ))}
        </div>

        {filtered.length > 0 ? (
          <DataTable<GateEvent>
            data={filtered}
            columns={eventColumns}
            keyField="ts"
            maxRows={50}
            pageSize={50}
            expandedKey={expandedKey}
            onExpandToggle={setExpandedKey}
            renderExpanded={(row) => (
              <div className="px-4 py-3 space-y-2 bg-bg-tertiary/30 text-sm">
                {row.reason && (
                  <div>
                    <span className="text-text-muted font-medium">Reason: </span>
                    <span className="text-text-secondary">{row.reason}</span>
                  </div>
                )}
                {row.editedFiles && row.editedFiles.length > 0 && (
                  <div>
                    <span className="text-text-muted font-medium">Files: </span>
                    <span className="font-mono text-text-secondary">{row.editedFiles.join(', ')}</span>
                  </div>
                )}
                {row.verify && Object.keys(row.verify).length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span className="text-text-muted font-medium">Verify:</span>
                    {Object.entries(row.verify).map(([k, v]) => (
                      <span key={k} className="font-mono">
                        <span className="text-text-muted">{k}</span>
                        <span className="text-text-disabled">: </span>
                        <span className="text-text-secondary">{v ?? 'null'}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            rowKeyFn={(row) => row.ts + row.sessionId}
          />
        ) : (
          <div className="rounded-lg border border-border-primary bg-bg-secondary p-8 text-center text-sm text-text-muted">
            No gate events in the selected filter.
          </div>
        )}
      </div>
    </div>
  );
}

export function LearningPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [feedbackExpandedKey, setFeedbackExpandedKey] = useState<string | null>(null);
  const [loopExpandedKey, setLoopExpandedKey] = useState<string | null>(null);
  const [correctionExpandedKey, setCorrectionExpandedKey] = useState<string | null>(null);

  const { data: loopData, isLoading: loopLoading, error: loopError, refetch: loopRefetch } = useObsLearningLoop();
  const { data: feedbackData, isLoading: feedbackLoading, error: feedbackError, refetch: feedbackRefetch } = useObsLearningFeedback();
  const { data: gateData } = useObsGateEvents();
  const { data: patternsData } = useObsGatePatterns();
  const { data: memUsage } = useObsMemoryUsage(range);

  // Compute summary stats
  const memoriesStored = loopData?.memoryCount ?? 0;
  const avgRating = feedbackData?.avgRating ?? 0;
  const gatePassRate =
    gateData && gateData.total > 0
      ? (gateData.passCount / gateData.total) * 100
      : null;
  const circumventions = patternsData?.patterns.length ?? 0;

  // Corrections: group negative-polarity feedback by trigger word
  const correctionGroups: CorrectionGroup[] = (() => {
    if (!feedbackData?.items) return [];
    const map = new Map<string, { count: number; lastTs: string; items: FeedbackItem[] }>();
    for (const item of feedbackData.items) {
      if (item.rating > 3) continue;
      const key = item.trigger.split(/[\s,]+/)[0].toLowerCase() || 'unknown';
      const existing = map.get(key);
      if (existing) {
        existing.count++;
        if (item.ts > existing.lastTs) existing.lastTs = item.ts;
        existing.items.push(item);
      } else {
        map.set(key, { count: 1, lastTs: item.ts, items: [item] });
      }
    }
    return [...map.entries()]
      .map(([trigger, { count, lastTs, items }]) => ({ trigger, count, lastTs, items }))
      .sort((a, b) => b.count - a.count);
  })();

  // Loop table columns — Type badge merged inline with Insight to avoid redundancy
  const loopColumns: Column<LoopItem>[] = [
    {
      key: 'ts',
      label: 'Time',
      width: '140px',
      render: (row) => (
        <span className="font-mono text-text-secondary whitespace-nowrap text-xs">{compactTs(row.ts)}</span>
      ),
    },
    {
      key: 'source',
      label: 'Source',
      width: '200px',
      render: (row) => (
        <span className="text-text-secondary text-sm" title={row.source}>{row.source}</span>
      ),
    },
    {
      key: 'insight',
      label: 'Insight',
      render: (row) => (
        <span className="flex items-center gap-2">
          <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold shrink-0', loopTypeBadge(row.type))}>
            {row.type}
          </span>
          <span className="text-text-muted text-sm italic" title={row.insight}>{row.insight}</span>
        </span>
      ),
    },
    {
      key: 'memoryId',
      label: 'Memory',
      width: '120px',
      render: (row) =>
        row.memoryId ? (
          <Link
            to={`/observability/memory?highlight=${row.memoryId}`}
            className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-accent/10 text-accent hover:bg-accent/20 transition-colors font-mono"
          >
            {row.memoryId.slice(0, 8)}
          </Link>
        ) : (
          <span className="text-text-disabled">—</span>
        ),
    },
    {
      key: 'sessionId',
      label: 'Session',
      width: '80px',
      render: (row) => <SessionLink sessionId={row.sessionId} />,
    },
  ];

  // Feedback table columns
  const feedbackColumns: Column<FeedbackItem>[] = [
    {
      key: 'ts',
      label: 'Time',
      width: '140px',
      render: (row) => (
        <span className="font-mono text-text-secondary whitespace-nowrap text-xs">{compactTs(row.ts)}</span>
      ),
    },
    {
      key: 'trigger',
      label: 'Prompt',
      render: (row) => (
        <span className="text-text-primary text-sm break-words" style={{ wordBreak: 'break-word', whiteSpace: 'normal' }}>
          {row.trigger}
        </span>
      ),
    },
    {
      key: 'rating',
      label: 'Signal',
      width: '140px',
      render: (row) => <SignalBadge rating={row.rating} />,
    },
    {
      key: 'sessionId',
      label: 'Session',
      width: '80px',
      render: (row) => <SessionLink sessionId={row.sessionId} turnIndex={row.turnIndex} />,
    },
  ];

  // Corrections table columns
  const correctionColumns: Column<CorrectionGroup>[] = [
    {
      key: 'trigger',
      label: 'Trigger',
      width: '140px',
      render: (row) => (
        <span className="font-mono text-text-primary text-sm font-semibold">{row.trigger}</span>
      ),
    },
    {
      key: 'count',
      label: 'Count',
      width: '70px',
      align: 'right',
      render: (row) => (
        <span className={clsx('font-mono font-semibold text-sm', row.count >= 5 ? 'text-error' : row.count >= 2 ? 'text-warning' : 'text-text-secondary')}>
          {row.count}
        </span>
      ),
    },
    {
      key: 'lastTs',
      label: 'Last',
      width: '115px',
      render: (row) => (
        <span className="font-mono text-text-muted text-xs whitespace-nowrap">{compactTs(row.lastTs)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar
        title="Learning"
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      />

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 !mt-0">
        <StatCard label="Memories Stored" value={fmtNumber(memoriesStored)} accent={memoriesStored > 0 ? 'success' : undefined} />
        <StatCard
          label="Memories Read"
          value={memUsage ? fmtNumber(memUsage.searches) : '—'}
          accent={memUsage && memUsage.searches > 0 ? 'success' : undefined}
        />
        <StatCard
          label="Avg Rating"
          value={avgRating > 0 ? avgRating.toFixed(1) : '—'}
          accent={avgRating >= 7 ? 'success' : avgRating >= 4 ? 'warning' : avgRating > 0 ? 'error' : undefined}
        />
        <StatCard
          label="Gate Pass Rate"
          value={gatePassRate !== null ? fmtPct(gatePassRate) : '—'}
          accent={
            gatePassRate !== null
              ? gatePassRate >= 80 ? 'success' : gatePassRate >= 60 ? 'warning' : 'error'
              : undefined
          }
        />
        <button
          type="button"
          onClick={() => document.getElementById('gates-section')?.scrollIntoView({ behavior: 'smooth' })}
          className="text-left w-full hover:brightness-105 transition-all"
        >
          <StatCard
            label="Circumventions"
            value={fmtNumber(circumventions)}
            accent={circumventions === 0 ? 'success' : circumventions < 5 ? 'warning' : 'error'}
          />
        </button>
      </div>

      {/* Learning Loop section */}
      <div className="space-y-3">
        <h2 className="font-heading text-lg font-medium text-text-secondary">Learning Loop</h2>
        {loopLoading ? (
          <PageLoading />
        ) : loopError || !loopData ? (
          <ErrorState message="Failed to load learning loop data" retry={loopRefetch} />
        ) : loopData.items.length === 0 ? (
          <div className="rounded-lg border border-border-primary bg-bg-secondary p-8 text-center space-y-1">
            <p className="text-sm text-text-muted">No learning loop events recorded.</p>
            <p className="text-xs text-text-disabled">
              Populated after sessions with ≥6 messages and ≥1 edit, when the memory writer stores a new entry.
            </p>
          </div>
        ) : (
          <DataTable<LoopItem>
            data={loopData.items}
            columns={loopColumns}
            keyField="ts"
            maxRows={50}
            pageSize={50}
            expandedKey={loopExpandedKey}
            onExpandToggle={setLoopExpandedKey}
            renderExpanded={(row) => (
              <div className="px-4 py-3 space-y-2 bg-bg-tertiary/30 text-sm">
                {row.content && (
                  <div>
                    <span className="text-text-muted font-medium">Content: </span>
                    <span className="text-text-secondary">{row.content}</span>
                  </div>
                )}
                {row.tags && (
                  <div>
                    <span className="text-text-muted font-medium">Tags: </span>
                    <span className="font-mono text-text-disabled">{row.tags}</span>
                  </div>
                )}
              </div>
            )}
            rowKeyFn={(row) => row.ts + row.sessionId}
          />
        )}
      </div>

      {/* Feedback & Ratings section */}
      <div className="space-y-3">
        <h2 className="font-heading text-lg font-medium text-text-secondary">Feedback</h2>
        {feedbackLoading ? (
          <PageLoading />
        ) : feedbackError || !feedbackData ? (
          <ErrorState message="Failed to load feedback data" retry={feedbackRefetch} />
        ) : feedbackData.items.length === 0 ? (
          <div className="rounded-lg border border-border-primary bg-bg-secondary p-8 text-center text-sm text-text-muted">
            No feedback recorded.
          </div>
        ) : (
          <DataTable<FeedbackItem>
            data={feedbackData.items}
            columns={feedbackColumns}
            keyField="ts"
            maxRows={50}
            pageSize={50}
            expandedKey={feedbackExpandedKey}
            onExpandToggle={setFeedbackExpandedKey}
            renderExpanded={(row) => (
              <div className="px-4 py-3 space-y-2 bg-bg-tertiary/30 text-sm">
                <div>
                  <span className="text-text-muted font-medium">Prompt: </span>
                  <span className="text-text-primary">{row.trigger}</span>
                </div>
                {row.priorText && (
                  <div>
                    <span className="text-text-muted font-medium">Prior response: </span>
                    <span className="text-text-secondary">{row.priorText}</span>
                  </div>
                )}
                {row.priorTools && row.priorTools.length > 0 && (
                  <div>
                    <span className="text-text-muted font-medium">Tools: </span>
                    <span className="font-mono text-text-secondary">{row.priorTools.join(', ')}</span>
                  </div>
                )}
                {row.priorFiles && row.priorFiles.length > 0 && (
                  <div>
                    <span className="text-text-muted font-medium">Files: </span>
                    <span className="font-mono text-text-secondary">{row.priorFiles.join(', ')}</span>
                  </div>
                )}
              </div>
            )}
            rowKeyFn={(row) => row.ts + row.sessionId}
          />
        )}
      </div>

      {/* Corrections section */}
      <div className="space-y-3">
        <div>
          <h2 className="font-heading text-lg font-medium text-text-secondary">Corrections</h2>
          <p className="text-xs text-text-disabled mt-0.5">
            Negative feedback grouped by trigger word — a proxy for directive adherence.
          </p>
        </div>
        {feedbackLoading ? (
          <PageLoading />
        ) : correctionGroups.length === 0 ? (
          <div className="rounded-lg border border-border-primary bg-bg-secondary p-8 text-center text-sm text-text-muted">
            No corrections recorded.
          </div>
        ) : (
          <DataTable<CorrectionGroup>
            data={correctionGroups}
            columns={correctionColumns}
            keyField="trigger"
            maxRows={50}
            expandedKey={correctionExpandedKey}
            onExpandToggle={setCorrectionExpandedKey}
            renderExpanded={(row) => (
              <div className="px-4 py-3 space-y-1.5 bg-bg-tertiary/30">
                {row.items.map((item, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm">
                    <span className="font-mono text-text-disabled text-xs whitespace-nowrap shrink-0">{compactTs(item.ts)}</span>
                    <span className="text-text-secondary flex-1">{item.trigger}</span>
                    <SessionLink sessionId={item.sessionId} turnIndex={item.turnIndex} />
                  </div>
                ))}
              </div>
            )}
            rowKeyFn={(row) => row.trigger}
          />
        )}
      </div>

      {/* Gates section */}
      <div id="gates-section" className="space-y-3">
        <h2 className="font-heading text-lg font-medium text-text-secondary">Gates</h2>
        <GatesSection />
      </div>
    </div>
  );
}
