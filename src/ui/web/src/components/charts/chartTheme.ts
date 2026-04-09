import { shortDate, fmtNumber } from '../../utils/format';

export const CHART_PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
];

export const tooltipStyle = {
  background: 'var(--chart-tooltip-bg)',
  border: '1px solid var(--chart-tooltip-border)',
  borderRadius: 2,
  fontSize: 12,
  color: 'var(--text-primary)',
};

export const gridProps = {
  strokeDasharray: '3 3',
  stroke: 'var(--chart-grid)',
} as const;

export const axisProps = {
  stroke: 'var(--chart-text)',
  fontSize: 12,
  tickLine: false as const,
  axisLine: false as const,
  domain: [0, 'auto'] as [number, string],
  tickFormatter: (v: number) => fmtNumber(v),
};

// Use this instead of {...axisProps} tickFormatter={shortDate} on all date XAxes.
// interval="equidistantPreserveStart" evenly distributes ticks and avoids crowding.
export const xAxisDateProps = {
  stroke: 'var(--chart-text)',
  fontSize: 12,
  tickLine: false as const,
  axisLine: false as const,
  tickFormatter: shortDate,
  interval: 'equidistantPreserveStart' as const,
};

export const legendProps = {
  wrapperStyle: { fontSize: 12 },
};

export function labelFormatter(label: unknown): string {
  if (typeof label !== 'string') return String(label);
  // Delegate to shortDate for consistent formatting
  try {
    if (label.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(label)) {
      return shortDate(label);
    }
  } catch (e) {
    console.warn('labelFormatter: failed to format date', label, e);
  }
  return label;
}
