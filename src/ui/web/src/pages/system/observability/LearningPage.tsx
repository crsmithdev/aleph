import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useObsLearningLoop,
  useObsLearningFeedback,
  useObsGateEvents,
} from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { type Granularity, type TimeRange } from '../../../components/data/TimeRangeSelector';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
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
  polarity?: 'positive' | 'negative';
  rating?: number;
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

type GateHookRow = {
  hook: string;
  total: number;
  passCount: number;
  blockCount: number;
  advisoryCount: number;
  skipCount: number;
  lastTs: string;
  events: GateEvent[];
};

type CorrectionGroup = {
  trigger: string;
  count: number;
  lastTs: string;
  items: FeedbackItem[];
};

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

/** Signal badge — unified ▲/▼ notation for both sentiment and numeric feedback. */
function SignalBadge({ item }: { item: FeedbackItem }) {
  if (item.type === 'numeric' && item.rating !== undefined) {
    const r = item.rating;
    if (r >= 7) {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-green-500/15 text-green-400">
          ▲ {r}/10
        </span>
      );
    }
    if (r <= 3) {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-red-500/15 text-red-400">
          ▼ {r}/10
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-yellow-500/15 text-yellow-400">
        ~ {r}/10
      </span>
    );
  }
  if (item.polarity === 'positive') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-green-500/15 text-green-400">
        ▲ positive
      </span>
    );
  }
  if (item.polarity === 'negative') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-red-500/15 text-red-400">
        ▼ negative
      </span>
    );
  }
  return <span className="text-text-disabled">—</span>;
}

function GatesSection() {
  const { data: eventsData, isLoading, error, refetch } = useObsGateEvents();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (isLoading) return <PageLoading />;
  if (error || !eventsData) return <ErrorState message="Failed to load gate events" retry={refetch} />;

  // Group events by hook name
  const hookMap = new Map<string, GateHookRow>();
  for (const ev of eventsData.events as GateEvent[]) {
    let row = hookMap.get(ev.hook);
    if (!row) {
      row = { hook: ev.hook, total: 0, passCount: 0, blockCount: 0, advisoryCount: 0, skipCount: 0, lastTs: ev.ts, events: [] };
      hookMap.set(ev.hook, row);
    }
    row.total++;
    if (ev.decision === 'pass') row.passCount++;
    else if (ev.decision === 'block') row.blockCount++;
    else if (ev.decision === 'advisory') row.advisoryCount++;
    else if (ev.decision === 'skip') row.skipCount++;
    if (ev.ts > row.lastTs) row.lastTs = ev.ts;
    row.events.push(ev);
  }
  const hookRows = [...hookMap.values()].sort((a, b) => b.lastTs.localeCompare(a.lastTs));

  const columns: Column<GateHookRow>[] = [
    {
      key: 'hook',
      label: 'Hook',
      render: (row) => <span className="font-mono text-text-primary text-sm">{row.hook}</span>,
    },
    {
      key: 'passCount',
      label: 'Pass',
      width: '70px',
      align: 'right',
      render: (row) => row.passCount > 0
        ? <span className="font-mono text-sm text-green-400">{fmtNumber(row.passCount)}</span>
        : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'blockCount',
      label: 'Block',
      width: '70px',
      align: 'right',
      render: (row) => row.blockCount > 0
        ? <span className="font-mono text-sm text-red-400">{fmtNumber(row.blockCount)}</span>
        : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'advisoryCount',
      label: 'Advisory',
      width: '80px',
      align: 'right',
      render: (row) => row.advisoryCount > 0
        ? <span className="font-mono text-sm text-yellow-400">{fmtNumber(row.advisoryCount)}</span>
        : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'skipCount',
      label: 'Skip',
      width: '70px',
      align: 'right',
      render: (row) => row.skipCount > 0
        ? <span className="font-mono text-sm text-text-secondary">{fmtNumber(row.skipCount)}</span>
        : <span className="text-text-disabled">—</span>,
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

  // Inner event columns for expanded rows
  const eventColumns: Column<GateEvent>[] = [
    {
      key: 'ts',
      label: 'Time',
      width: '115px',
      render: (row) => (
        <span className="font-mono text-text-secondary whitespace-nowrap text-xs">{compactTs(row.ts)}</span>
      ),
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
      width: '200px',
      render: (row) => {
        if (!row.editedFiles?.length) return <span className="text-text-disabled">—</span>;
        return (
          <span className="font-mono text-text-muted text-xs" title={row.editedFiles.join(', ')}>
            {row.editedFiles.slice(0, 2).join(', ')}
            {row.editedFiles.length > 2 && ` +${row.editedFiles.length - 2}`}
          </span>
        );
      },
    },
    {
      key: 'reason',
      label: 'Details',
      render: (row) => {
        const parts: Array<{ key: string; value: string }> = [];
        if (row.verifyPresent) parts.push({ key: 'verify', value: 'present' });
        if (row.verifyMissing?.length) parts.push({ key: 'missing', value: row.verifyMissing.join(', ') });
        if (row.verify) Object.entries(row.verify).forEach(([k, v]) => parts.push({ key: k, value: v ?? 'null' }));
        if (parts.length === 0) {
          return (
            <span className="text-text-muted text-xs" title={row.reason}>
              {row.reason.slice(0, 100)}{row.reason.length > 100 && '…'}
            </span>
          );
        }
        return (
          <span className="text-xs font-mono flex flex-wrap gap-2">
            {parts.slice(0, 3).map(({ key, value }, i) => (
              <span key={i}>
                <span className="text-text-muted">{key}</span>
                <span className="text-text-disabled">=</span>
                <span className="text-text-secondary">{value.length > 30 ? value.slice(0, 30) + '…' : value}</span>
              </span>
            ))}
            {parts.length > 3 && <span className="text-text-disabled">+{parts.length - 3}</span>}
          </span>
        );
      },
    },
    {
      key: 'sessionId',
      label: 'Session',
      width: '80px',
      render: (row) => <SessionLink sessionId={row.sessionId} />,
    },
  ];

  if (hookRows.length === 0) {
    return (
      <div className="rounded-lg border border-border-primary bg-bg-secondary p-8 text-center text-sm text-text-muted">
        No gate events recorded.
      </div>
    );
  }

  return (
    <DataTable<GateHookRow>
      data={hookRows}
      columns={columns}
      keyField="hook"
      maxRows={50}
      pageSize={50}
      expandedKey={expandedKey}
      onExpandToggle={setExpandedKey}
      renderExpanded={(row) => (
        <div className="px-4 py-3 bg-bg-tertiary/20">
          <DataTable<GateEvent>
            data={row.events.slice().sort((a, b) => b.ts.localeCompare(a.ts))}
            columns={eventColumns}
            keyField="ts"
            maxRows={50}
            pageSize={50}
            rowKeyFn={(ev) => ev.ts + ev.sessionId}
          />
        </div>
      )}
      rowKeyFn={(row) => row.hook}
    />
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

  // Compute summary stats
  const memoriesStored = loopData?.memoryCount ?? 0;
  const avgRating = feedbackData?.avgRating ?? 0;
  const gatePassRate =
    gateData && gateData.total > 0
      ? (gateData.passCount / gateData.total) * 100
      : null;
  const blockCount = gateData?.blockCount ?? 0;

  // Corrections: group negative-polarity feedback by trigger word
  const correctionGroups: CorrectionGroup[] = (() => {
    if (!feedbackData?.items) return [];
    const map = new Map<string, { count: number; lastTs: string; items: FeedbackItem[] }>();
    for (const item of feedbackData.items) {
      if (item.polarity !== 'negative') continue;
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

  // Loop table columns
  const loopColumns: Column<LoopItem>[] = [
    {
      key: 'ts',
      label: 'Time',
      width: '115px',
      render: (row) => (
        <span className="font-mono text-text-secondary whitespace-nowrap text-xs">{compactTs(row.ts)}</span>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      width: '110px',
      render: (row) => (
        <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold', loopTypeBadge(row.type))}>
          {row.type}
        </span>
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
        <span className="text-text-muted text-sm italic" title={row.insight}>{row.insight}</span>
      ),
    },
    {
      key: 'memoryId',
      label: 'Memory',
      width: '100px',
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
      width: '115px',
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
      render: (row) => <SignalBadge item={row} />,
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 !mt-0">
        <StatCard label="Memories Stored" value={fmtNumber(memoriesStored)} accent={memoriesStored > 0 ? 'success' : undefined} />
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
        <StatCard
          label="Blocks"
          value={fmtNumber(blockCount)}
          accent={blockCount === 0 ? 'success' : blockCount < 10 ? 'warning' : 'error'}
        />
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
      <div className="space-y-3">
        <h2 className="font-heading text-lg font-medium text-text-secondary">Gates</h2>
        <GatesSection />
      </div>
    </div>
  );
}
