/**
 * ResearchActivityView — merged Events + Telemetry + Reviews tab.
 *
 * Layout follows docs/mockups/research-activity.html (Variant A):
 *   - Top: 6-card KPI strip (Findings · Steps · Source failure · Errors · Cost · Stuck)
 *   - Left column: latest verdict, iteration checks, job lifecycle table,
 *     source extraction, thread state stackbar, decisions
 *   - Right column (sticky): live event log with the six-pill filter bar
 *
 * Refinements vs the original three tabs:
 *   - Cost-trajectory svg dropped (cost shows in the KPI strip).
 *   - Job lifecycle compacted from four pillar cards to one 4×4 table.
 *   - Thread state compacted from a 6-tile grid to one stackbar plus counts;
 *     the stuck-thread list keeps full size — that's the actionable bit.
 */
import { useMemo } from 'react';
import {
  type ResearchQuery,
  useResearchFindings, useResearchThreads, useResearchSteps, useResearchStream,
  useResearchCosts, useResearchRunning,
  useJobMetrics, useSourceHealth, useThreadStateMetrics,
  useIterationChecks, usePostMortems, useRunPostMortem,
} from '../../api/research-hooks';
import { ResearchEventsList } from './ResearchEventsList';
import {
  JobLifecycleCompactPanel,
  SourceHealthPanel,
  ThreadStateCompactPanel,
  DecisionLogPanel,
} from './ResearchTelemetryView';
import { PostMortemCard, IterationCheckCard } from './ResearchReviewsView';
import { Button } from '../../components/ui/Button';
import { StatCard } from '../../components/data/StatCard';

interface Props {
  session: ResearchQuery;
  sessionId: string;
  onNavigateToThread?: (id: string) => void;
}

function fmtUsd(n: number | undefined | null): string {
  if (n == null) return '—';
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function fmtMin(ms: number | undefined | null): string {
  if (!ms) return '0m';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// Activity KPIs use StatCard with `compact`. 'info'/'accent' map to 'default'
// (text-accent) and 'warn' maps to 'warning' to fit StatCard's accent set.
type KpiTone = 'default' | 'success' | 'info' | 'warn' | 'error' | 'accent';
const TONE_TO_ACCENT: Record<KpiTone, 'default' | 'neutral' | 'success' | 'warning' | 'error'> = {
  default: 'neutral',
  success: 'success',
  info: 'default',
  warn: 'warning',
  error: 'error',
  accent: 'default',
};

export function ResearchActivityView({ session, sessionId, onNavigateToThread }: Props) {
  const { data: findings = [] } = useResearchFindings(sessionId);
  const { data: threads = [] } = useResearchThreads(sessionId);
  const { data: allSteps = [] } = useResearchSteps(sessionId);
  const { events } = useResearchStream(sessionId);
  const { data: costs } = useResearchCosts(sessionId);
  const { data: running } = useResearchRunning(sessionId);
  const isRunning = running?.running ?? false;

  const { data: jobMetrics } = useJobMetrics(sessionId);
  const { data: sourceHealth } = useSourceHealth(sessionId);
  const { data: threadMetrics } = useThreadStateMetrics(sessionId, { stuckThresholdMs: 5 * 60_000 });

  const { data: postMortems = [] } = usePostMortems(sessionId);
  const { data: iterationChecks = [] } = useIterationChecks(sessionId);
  const runPostMortem = useRunPostMortem();
  const reviewError = runPostMortem.error instanceof Error ? runPostMortem.error.message : null;

  // KPI numbers
  const kpis = useMemo(() => {
    const errorSteps = allSteps.filter(s => !!s.error).length;
    const errorPct = allSteps.length > 0 ? (errorSteps / allSteps.length) * 100 : 0;
    const activeThreadCount = threads.filter(t => t.status === 'active').length;
    const stuckCount = threadMetrics?.stuck_threads.length ?? 0;
    const totalAttempts = sourceHealth?.total ?? 0;
    const failureRate = sourceHealth ? sourceHealth.failure_rate * 100 : 0;
    const failedCount = sourceHealth?.by_status?.failed ?? 0;
    const totalTokens = allSteps.reduce((s, x) => s + (x.prompt_tokens ?? 0) + (x.completion_tokens ?? 0), 0);
    const durationMs = jobMetrics?.total_ms?.avg ? jobMetrics.total_ms.avg * Math.max(1, jobMetrics.total_ms.count) : 0;
    return {
      findings: findings.length,
      steps: allSteps.length,
      activeThreadCount,
      threadCount: threads.length,
      sourceFailurePct: failureRate,
      sourceFailedCount: failedCount,
      sourceTotal: totalAttempts,
      errorSteps,
      errorPct,
      cost: costs?.total_cost ?? 0,
      tokens: totalTokens,
      durationMs,
      stuckCount,
    };
  }, [findings.length, allSteps, threads, threadMetrics, sourceHealth, costs, jobMetrics]);

  const latestPostMortem = postMortems[0];
  const latestIsFlag = latestPostMortem?.verdict === 'flag';

  return (
    <div className="pb-12">
      {/* KPI strip */}
      <div className="grid gap-4 mb-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Findings"
          value={kpis.findings}
          accent={TONE_TO_ACCENT.success}
          compact
          detail={isRunning ? 'live' : undefined}
        />
        <StatCard
          label="Steps"
          value={kpis.steps}
          accent={TONE_TO_ACCENT.info}
          compact
          detail={`${kpis.activeThreadCount} active · ${kpis.threadCount} threads`}
        />
        <StatCard
          label="Source failure"
          value={`${kpis.sourceFailurePct.toFixed(1)}%`}
          accent={TONE_TO_ACCENT[kpis.sourceFailurePct > 25 ? 'error' : kpis.sourceFailurePct > 10 ? 'warn' : 'default']}
          compact
          detail={kpis.sourceTotal > 0 ? `${kpis.sourceFailedCount} of ${kpis.sourceTotal} attempts` : 'no attempts yet'}
        />
        <StatCard
          label="Errors"
          value={kpis.errorSteps}
          accent={TONE_TO_ACCENT[kpis.errorSteps > 0 ? 'error' : 'default']}
          compact
          detail={kpis.steps > 0 ? `${kpis.errorPct.toFixed(1)}% of steps` : '—'}
        />
        <StatCard
          label="Cost"
          value={fmtUsd(kpis.cost)}
          accent={TONE_TO_ACCENT.accent}
          compact
          detail={kpis.tokens > 0 ? `${fmtMin(kpis.durationMs)} · ${(kpis.tokens / 1000).toFixed(0)}k tokens` : undefined}
        />
        <StatCard
          label="Stuck"
          value={kpis.stuckCount}
          accent={TONE_TO_ACCENT[kpis.stuckCount > 0 ? 'warn' : 'default']}
          compact
          detail={kpis.stuckCount > 0 ? '≥ 5m in same state' : 'no stuck threads'}
        />
      </div>

      {/* Two-column dashboard */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* LEFT column */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* Latest verdict — flagged or pass */}
          {latestPostMortem ? (
            <div>
              <div className="flex items-center justify-end mb-1.5">
                <Button
                  size="sm" variant="ghost"
                  loading={runPostMortem.isPending}
                  onClick={() => runPostMortem.mutate({ sessionId })}
                >Re-run review</Button>
              </div>
              <PostMortemCard record={latestPostMortem} latest={true} query={session} />
              {reviewError && <p className="text-sm text-error mt-2">{reviewError}</p>}
            </div>
          ) : (
            <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-heading text-lg font-medium text-text-secondary">Post-mortem</h3>
                <Button
                  size="sm"
                  loading={runPostMortem.isPending}
                  onClick={() => runPostMortem.mutate({ sessionId })}
                >Run review now</Button>
              </div>
              <p className="text-sm text-text-muted">
                No post-mortems yet. They fire automatically once each priority job finishes — or click run-review to capture one now.
              </p>
              {reviewError && <p className="text-sm text-error mt-2">{reviewError}</p>}
            </div>
          )}

          {/* Iteration checks */}
          <div className="rounded-lg border border-border-primary bg-bg-secondary">
            <div className="flex items-baseline gap-3 px-4 py-3 border-b border-border-primary">
              <h3 className="font-heading text-lg font-medium text-text-secondary">Iteration checks</h3>
              {iterationChecks.length > 0 && (
                <span className="text-xs text-text-muted">{iterationChecks.length} check{iterationChecks.length === 1 ? '' : 's'}</span>
              )}
            </div>
            {iterationChecks.length === 0 && (
              <div className="p-4 text-sm text-text-muted">
                Iteration checks fire every 5 iterations. They spot-check drift and can auto-prune off-topic threads.
              </div>
            )}
            {iterationChecks.length > 0 && (
              <div className="p-4 flex flex-col gap-2">
                {iterationChecks.slice(0, 3).map(c => (
                  <IterationCheckCard key={c.id} record={c} query={session} />
                ))}
                {iterationChecks.length > 3 && (
                  <div className="text-xs text-text-muted">+{iterationChecks.length - 3} earlier checks</div>
                )}
              </div>
            )}
          </div>

          {/* Job lifecycle — compact 4×4 table */}
          <JobLifecycleCompactPanel sessionId={sessionId} />

          {/* Source extraction — compact two-column */}
          <SourceHealthPanel sessionId={sessionId} compact />

          {/* Thread state — stackbar + counts + stuck list */}
          <ThreadStateCompactPanel sessionId={sessionId} onNavigateToThread={onNavigateToThread} />

          {/* Decisions */}
          <DecisionLogPanel sessionId={sessionId} />
        </div>

        {/* RIGHT column: sticky event log */}
        <div className="min-w-0">
          <div className="lg:sticky lg:top-2 rounded-lg border border-border-primary overflow-hidden flex flex-col" style={{ height: 'min(86vh, 1080px)' }}>
            <ResearchEventsList
              sessionId={sessionId}
              threads={threads}
              findings={findings}
              allSteps={allSteps}
              events={events}
              isRunning={isRunning}
              className="flex-1 min-h-0"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
