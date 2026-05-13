import type { ResearchStatsData } from '../../api/research-hooks';
import { fmtCurrency, fmtDuration } from '../../utils/format';
import { StatCard } from '../data/StatCard';

interface Props {
  stats: ResearchStatsData | undefined;
  totalRuns: number;
  byStatus: Record<string, number>;
  avgDurationMs: number;
  activeNow: number;
  rangeLabel: string;
}

const EMPTY = '—';

/** Six-cell KPI strip for the combined Research overview. */
export function HistorySummaryStrip({ stats, totalRuns, byStatus, avgDurationMs, activeNow, rangeLabel }: Props) {
  const findings = stats?.totalFindings ?? 0;
  const spend = stats?.totalCost ?? 0;
  const passRate = stats?.passRate ?? 0;
  const flagRate = stats?.flagRate ?? 0;
  const haltRate = stats?.haltRate ?? 0;
  const hasVerdicts = passRate + flagRate + haltRate > 0;
  const hasSpend = spend >= 0.005;
  const avgFindingsPerRun = totalRuns > 0 ? findings / totalRuns : 0;
  const avgSpendPerRun = totalRuns > 0 ? spend / totalRuns : 0;

  return (
    <div
      className="grid gap-4 px-6 py-4 border-b border-border-primary bg-bg-secondary"
      style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}
    >
      <StatCard
        compact
        accent={totalRuns > 0 ? 'default' : 'neutral'}
        label={`Runs · ${rangeLabel}`}
        value={totalRuns > 0 ? String(totalRuns) : EMPTY}
        detail={totalRuns > 0 ? `${byStatus.active ?? 0} active · ${byStatus.completed ?? 0} done · ${byStatus.halted ?? 0} halted` : undefined}
      />
      <StatCard
        compact
        accent={findings > 0 ? 'success' : 'neutral'}
        label={`Findings · ${rangeLabel}`}
        value={findings > 0 ? fmtCount(findings) : EMPTY}
        detail={findings > 0 ? `avg ${avgFindingsPerRun.toFixed(1)} / run` : undefined}
      />
      <StatCard
        compact
        accent="neutral"
        label={`Spend · ${rangeLabel}`}
        value={hasSpend ? fmtCurrency(spend) : EMPTY}
        detail={hasSpend ? `${fmtCurrency(avgSpendPerRun)} / run` : undefined}
      />
      <PassRateCell pass={passRate} flag={flagRate} halt={haltRate} hasData={hasVerdicts} />
      <StatCard
        compact
        accent="neutral"
        label="Avg duration"
        value={avgDurationMs > 0 ? fmtDuration(avgDurationMs) : EMPTY}
      />
      <StatCard
        compact
        accent={activeNow > 0 ? 'default' : 'neutral'}
        label="Active now"
        value={activeNow > 0 ? String(activeNow) : EMPTY}
        detail={activeNow > 0 ? 'running' : undefined}
      />
    </div>
  );
}

function PassRateCell({ pass, flag, halt, hasData }: { pass: number; flag: number; halt: number; hasData: boolean }) {
  if (!hasData) {
    return <StatCard compact accent="neutral" label="Pass rate" value={EMPTY} />;
  }
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
