export const CHART_PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

export function tooltipStyle() {
  return {
    background: 'var(--chart-tooltip-bg)',
    border: '1px solid var(--chart-tooltip-border)',
    borderRadius: 8,
    fontSize: 12,
    color: 'var(--text-primary)',
  };
}

export const gridProps = {
  strokeDasharray: '3 3',
  stroke: 'var(--chart-grid)',
} as const;

export const axisProps = {
  stroke: 'var(--chart-text)',
  fontSize: 12,
  tickLine: false as const,
  axisLine: false as const,
};

export function labelFormatter(label: unknown): string {
  return typeof label === 'string' ? label.slice(5) : String(label);
}
