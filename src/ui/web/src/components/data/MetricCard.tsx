import { clsx } from 'clsx';

export type MetricAccent = 'accent' | 'success' | 'warning' | 'magenta';

const heroColor: Record<MetricAccent, string> = {
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  magenta: 'text-magenta',
};

const strokeColor: Record<MetricAccent, string> = {
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  magenta: 'var(--magenta)',
};

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  const w = 110;
  const h = 36;
  const stepX = values.length === 1 ? 0 : w / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = h - (v / max) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="w-[110px] h-[36px] flex-shrink-0"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}

/** Day-level metric: today as the hero, a 7-day sparkline, and the change vs yesterday. */
export function MetricCard({
  label,
  today,
  yesterday,
  spark,
  accent = 'accent',
}: {
  label: string;
  today: number;
  yesterday: number;
  spark?: number[];
  accent?: MetricAccent;
}) {
  const delta = today - yesterday;
  const deltaClass = delta > 0 ? 'text-success' : delta < 0 ? 'text-error' : 'text-text-muted';
  const deltaText =
    delta > 0 ? `+${delta} vs yesterday` : delta < 0 ? `−${Math.abs(delta)} vs yesterday` : '0 vs yesterday';

  return (
    <div className="bg-bg-secondary border border-border-primary rounded-xl px-4 py-3 flex flex-col gap-2">
      <div className="text-sm font-medium text-text-secondary">{label}</div>
      <div className="flex items-end justify-between gap-3">
        <div className={clsx('text-4xl font-bold leading-none tabular-nums', heroColor[accent])}>{today}</div>
        {spark && spark.length > 0 && <Sparkline values={spark} color={strokeColor[accent]} />}
      </div>
      <div className={clsx('text-sm tabular-nums', deltaClass)}>{deltaText}</div>
    </div>
  );
}
