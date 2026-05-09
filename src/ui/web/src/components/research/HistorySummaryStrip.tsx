import type { ResearchStatsData } from '../../api/research-hooks';
import { fmtCurrency, fmtDuration } from '../../utils/format';
import { StatCard } from '../data/StatCard';

interface Props {
  stats: ResearchStatsData | undefined;
  totalRuns: number;
  byStatus: Record<string, number>;
  avgDurationMs: number;
  avgConfidence: number;
}

/** Top-of-page strip with 6 cells summarising the active range. */
export function HistorySummaryStrip({ stats, totalRuns, byStatus, avgDurationMs, avgConfidence }: Props) {
  const findings = stats?.totalFindings ?? 0;
  const spend = stats?.totalCost ?? 0;
  const passRate = stats?.passRate ?? 0;
  const flagRate = stats?.flagRate ?? 0;
  const haltRate = stats?.haltRate ?? 0;
  const avgFindingsPerRun = totalRuns > 0 ? findings / totalRuns : 0;
  const avgSpendPerRun = totalRuns > 0 ? spend / totalRuns : 0;

  return (
    <div
      className="grid gap-4 px-6 py-4 border-b border-border-primary bg-bg-secondary"
      style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}
    >
      <StatCard
        compact
        accent="neutral"
        label="Total runs"
        value={String(totalRuns)}
        detail={`${byStatus.active ?? 0} active · ${byStatus.completed ?? 0} done · ${byStatus.halted ?? 0} halted`}
      />
      <StatCard
        compact
        accent="success"
        label="Findings"
        value={fmtCount(findings)}
        detail={totalRuns > 0 ? `avg ${avgFindingsPerRun.toFixed(1)} / run` : '—'}
      />
      <StatCard
        compact
        accent="default"
        label="Spend"
        value={fmtCurrency(spend)}
        detail={totalRuns > 0 ? `avg ${fmtCurrency(avgSpendPerRun)} / run` : '—'}
      />
      <PassRateCell pass={passRate} flag={flagRate} halt={haltRate} />
      <StatCard
        compact
        accent="neutral"
        label="Avg duration"
        value={avgDurationMs > 0 ? fmtDuration(avgDurationMs) : '—'}
      />
      <StatCard
        compact
        accent="neutral"
        label="Avg confidence"
        value={avgConfidence > 0 ? avgConfidence.toFixed(2) : '—'}
        detail={stats?.avgNovelty ? `novelty ${stats.avgNovelty.toFixed(2)}` : undefined}
      />
    </div>
  );
}

function PassRateCell({ pass, flag, halt }: { pass: number; flag: number; halt: number }) {
  const pctPass = Math.round(pass * 100);
  const pctFlag = Math.round(flag * 100);
  const pctHalt = Math.round(halt * 100);
  return (
    <StatCard
      compact
      accent="neutral"
      label="Pass rate"
      value={`${pctPass}%`}
      detailContent={
        <div
          className="mt-1 flex h-2 rounded overflow-hidden bg-bg-tertiary"
          title={`pass ${pctPass}% · flag ${pctFlag}% · halt ${pctHalt}%`}
        >
          <div className="h-full bg-success" style={{ width: `${pctPass}%` }} />
          <div className="h-full bg-warning" style={{ width: `${pctFlag}%` }} />
          <div className="h-full bg-error" style={{ width: `${pctHalt}%` }} />
        </div>
      }
    />
  );
}

function fmtCount(n: number): string {
  if (n >= 10_000) return Math.round(n / 1_000) + 'K';
  if (n >= 1_000) return n.toLocaleString();
  return String(n);
}
