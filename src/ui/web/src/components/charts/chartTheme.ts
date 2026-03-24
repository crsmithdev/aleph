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
  if (typeof label !== 'string') return String(label);
  // Sub-day keys: "2025-03-23T14" → "03-23 14:00", "2025-03-23T14:30" → "03-23 14:30"
  if (label.length > 10 && label.includes('T')) {
    const timePart = label.slice(11);
    return label.slice(5, 10) + ' ' + (timePart.length <= 2 ? timePart + ':00' : timePart);
  }
  // Day keys: "2025-03-23" → "03-23"
  return label.slice(5);
}
