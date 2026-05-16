import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useObsLearningLoop,
  useObsLearningFeedback,
  useObsGateEvents,
  useObsGatePatterns,
} from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { type Granularity, type TimeRange } from '../../../components/data/TimeRangeSelector';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { Icon } from '../../../components/ui/Icon';
import { fmtNumber, fmtPct, shortRelativeTime } from '../../../utils/format';
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

function DirectiveComplianceSection() {
  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary p-6 flex items-start gap-3">
      <Icon name="info" className="text-[18px] text-text-muted shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="text-sm text-text-secondary font-medium">Not yet available</p>
        <p className="text-xs text-text-muted">
          Directive compliance requires explicit tracking of whether each behavioral rule was followed or violated per turn.
          Current signal data (skill routing tags) shows skill selection, not rule adherence.
          This section will be populated once per-turn compliance signals are collected.
        </p>
      </div>
    </div>
  );
}

function GatesSection() {
  const { data: eventsData, isLoading: eventsLoading, error: eventsError, refetch: eventsRefetch } = useObsGateEvents();
  const { data: patternsData, isLoading: patternsLoading } = useObsGatePatterns();
  const [decisionFilter, setDecisionFilter] = useState<string | null>(null);

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
    ? eventsData.events.filter((e) => e.decision === decisionFilter)
    : eventsData.events;

  const columns: Column<GateEvent>[] = [
    {
      key: 'ts',
      label: 'Time',
      width: '160px',
      render: (row) => (
        <span className="font-mono text-text-secondary whitespace-nowrap text-xs">{shortRelativeTime(row.ts)}</span>
      ),
    },
    {
      key: 'hook',
      label: 'Hook',
      render: (row) => <span className="font-mono text-text-primary text-xs">{row.hook}</span>,
    },
    {
      key: 'decision',
      label: 'Decision',
      width: '100px',
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
      render: (row) => {
        if (!row.editedFiles || row.editedFiles.length === 0) {
          return <span className="text-text-disabled">—</span>;
        }
        return (
          <span className="font-mono text-text-muted text-xs truncate" title={row.editedFiles.join(', ')}>
            {row.editedFiles.slice(0, 2).join(', ')}
            {row.editedFiles.length > 2 && ` +${row.editedFiles.length - 2}`}
          </span>
        );
      },
    },
    {
      key: 'verify',
      label: 'Verify Details',
      render: (row) => {
        if (!row.verify && !row.verifyPresent && !row.verifyMissing?.length) {
          return <span className="text-text-disabled">—</span>;
        }
        const parts: string[] = [];
        if (row.verifyPresent) parts.push('present');
        if (row.verifyMissing?.length) parts.push(`missing: ${row.verifyMissing.join(', ')}`);
        if (row.verify) {
          const entries = Object.entries(row.verify)
            .map(([k, v]) => `${k}=${v ?? 'null'}`)
            .slice(0, 3);
          parts.push(...entries);
        }
        return (
          <span className="text-text-muted text-xs truncate" title={parts.join(' | ')}>
            {parts.slice(0, 2).join(' | ')}
            {parts.length > 2 && ` +${parts.length - 2}`}
          </span>
        );
      },
    },
    {
      key: 'sessionId',
      label: 'Session',
      width: '90px',
      render: (row) => <SessionLink sessionId={row.sessionId} />,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Pattern alerts */}
      {patternsData && patternsData.patterns.length > 0 && (
        <div className="space-y-2">
          {patternsData.patterns.map((pattern, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3"
            >
              <Icon name="warning" className="text-[18px] text-warning shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-text-primary text-xs">{pattern.hook}</span>
                  <span
                    className={clsx(
                      'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold',
                      decisionBadgeClass(pattern.decision),
                    )}
                  >
                    {pattern.decision}
                  </span>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-bg-tertiary text-text-secondary">
                    {fmtNumber(pattern.count)} occurrences
                  </span>
                </div>
                <div className="text-text-muted text-xs mt-1 truncate" title={pattern.representativeReason}>
                  {pattern.representativeReason}
                </div>
                {pattern.representativeFiles.length > 0 && (
                  <div className="font-mono text-text-disabled text-xs mt-0.5 truncate">
                    {pattern.representativeFiles.slice(0, 2).join(', ')}
                    {pattern.representativeFiles.length > 2 && ` +${pattern.representativeFiles.length - 2}`}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

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
          columns={columns}
          keyField="ts"
          maxRows={200}
        />
      ) : (
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-8 text-center text-sm text-text-muted">
          No gate events in the selected filter.
        </div>
      )}
    </div>
  );
}

export function LearningPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');

  const { data: loopData, isLoading: loopLoading, error: loopError, refetch: loopRefetch } = useObsLearningLoop();
  const { data: feedbackData, isLoading: feedbackLoading, error: feedbackError, refetch: feedbackRefetch } = useObsLearningFeedback();
  const { data: gateData } = useObsGateEvents();
  const { data: patternsData } = useObsGatePatterns();

  // Compute summary stats
  const memoriesStored = loopData?.items.filter((i) => i.memoryId).length ?? 0;
  const avgRating = feedbackData?.avgRating ?? 0;
  const gatePassRate =
    gateData && gateData.total > 0
      ? (gateData.passCount / gateData.total) * 100
      : null;
  const circumventions = patternsData?.patterns.length ?? 0;

  // Loop table columns
  const loopColumns: Column<LoopItem>[] = [
    {
      key: 'ts',
      label: 'Time',
      width: '160px',
      render: (row) => (
        <span className="font-mono text-text-secondary whitespace-nowrap text-xs">{shortRelativeTime(row.ts)}</span>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      width: '110px',
      render: (row) => (
        <span
          className={clsx(
            'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold',
            loopTypeBadge(row.type),
          )}
        >
          {row.type}
        </span>
      ),
    },
    {
      key: 'source',
      label: 'Source',
      width: '160px',
      render: (row) => (
        <span className="text-text-secondary text-xs truncate" title={row.source}>
          {row.source}
        </span>
      ),
    },
    {
      key: 'insight',
      label: 'Insight',
      render: (row) => (
        <span className="text-text-muted text-xs italic truncate" title={row.insight}>
          {row.insight}
        </span>
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
      width: '90px',
      render: (row) => <SessionLink sessionId={row.sessionId} />,
    },
  ];

  // Feedback table columns
  const feedbackColumns: Column<FeedbackItem>[] = [
    {
      key: 'ts',
      label: 'Time',
      width: '160px',
      render: (row) => (
        <span className="font-mono text-text-secondary whitespace-nowrap text-xs">{shortRelativeTime(row.ts)}</span>
      ),
    },
    {
      key: 'trigger',
      label: 'Trigger',
      render: (row) => (
        <span className="text-text-primary text-xs truncate" title={row.trigger} style={{ maxWidth: '320px', display: 'block' }}>
          {row.trigger}
        </span>
      ),
    },
    {
      key: 'rating',
      label: 'Rating / Polarity',
      width: '130px',
      render: (row) => {
        if (row.type === 'numeric' && row.rating !== undefined) {
          const colorClass =
            row.rating >= 7 ? 'text-success' : row.rating >= 4 ? 'text-warning' : 'text-error';
          return <span className={clsx('font-mono font-semibold text-sm', colorClass)}>{row.rating}</span>;
        }
        if (row.type === 'sentiment' && row.polarity) {
          return (
            <span
              className={clsx(
                'text-xs font-semibold',
                row.polarity === 'positive' ? 'text-success' : 'text-error',
              )}
            >
              {row.polarity}
            </span>
          );
        }
        return <span className="text-text-disabled">—</span>;
      },
    },
    {
      key: 'priorTools',
      label: 'Prior Context',
      render: (row) => {
        const parts = [
          ...(row.priorTools ?? []).slice(0, 2),
          ...(row.priorFiles ?? []).slice(0, 2),
        ];
        if (parts.length === 0) return <span className="text-text-disabled">—</span>;
        const full = [
          ...(row.priorTools ?? []),
          ...(row.priorFiles ?? []),
        ].join(', ');
        return (
          <span className="font-mono text-text-muted text-xs truncate" title={full}>
            {parts.join(', ')}
            {((row.priorTools?.length ?? 0) + (row.priorFiles?.length ?? 0)) > 4 &&
              ` +${(row.priorTools?.length ?? 0) + (row.priorFiles?.length ?? 0) - 4}`}
          </span>
        );
      },
    },
    {
      key: 'sessionId',
      label: 'Session',
      width: '90px',
      render: (row) => <SessionLink sessionId={row.sessionId} turnIndex={row.turnIndex} />,
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
        <StatCard label="Memories Stored" value={fmtNumber(memoriesStored)} />
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
              ? gatePassRate >= 80
                ? 'success'
                : gatePassRate >= 60
                  ? 'warning'
                  : 'error'
              : undefined
          }
        />
        <StatCard
          label="Circumventions"
          value={fmtNumber(circumventions)}
          accent={circumventions === 0 ? 'success' : circumventions < 3 ? 'warning' : 'error'}
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
          <div className="rounded-lg border border-border-primary bg-bg-secondary p-8 text-center text-sm text-text-muted">
            No learning loop events recorded.
          </div>
        ) : (
          <DataTable<LoopItem>
            data={loopData.items}
            columns={loopColumns}
            keyField="ts"
            maxRows={200}
          />
        )}
      </div>

      {/* Feedback & Ratings section */}
      <div className="space-y-3">
        <h2 className="font-heading text-lg font-medium text-text-secondary">Feedback & Ratings</h2>
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
            maxRows={200}
          />
        )}
      </div>

      {/* Directive Compliance section */}
      <div className="space-y-3">
        <h2 className="font-heading text-lg font-medium text-text-secondary">Directive Compliance</h2>
        <DirectiveComplianceSection />
      </div>

      {/* Gates section */}
      <div className="space-y-3">
        <h2 className="font-heading text-lg font-medium text-text-secondary">Gates</h2>
        <GatesSection />
      </div>
    </div>
  );
}
