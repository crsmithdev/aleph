import { clsx } from 'clsx';
import type { ReactNode } from 'react';

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

export function MetricCard({
  label,
  today,
  yesterday,
  week,
  spark,
  accent = 'accent',
}: {
  label: string;
  today: ReactNode;
  yesterday: ReactNode;
  week: ReactNode;
  spark?: number[];
  accent?: MetricAccent;
}) {
  return (
    <div className="bg-bg-secondary border border-border-primary rounded-xl px-4 py-3 flex flex-col gap-2">
      <div className="text-sm font-semibold uppercase tracking-wider text-text-muted">{label}</div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className={clsx('text-4xl font-bold leading-none tabular-nums', heroColor[accent])}>{today}</div>
          <div className="mt-2 text-sm text-text-muted flex items-baseline gap-3">
            <span>
              <span className="text-text-secondary tabular-nums">{yesterday}</span> yest
            </span>
            <span>
              <span className="text-text-secondary tabular-nums">{week}</span> 7d
            </span>
          </div>
        </div>
        {spark && spark.length > 0 && <Sparkline values={spark} color={strokeColor[accent]} />}
      </div>
    </div>
  );
}
