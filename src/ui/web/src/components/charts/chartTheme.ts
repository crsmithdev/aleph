export function getChartColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    c1: style.getPropertyValue('--chart-1').trim() || '#6366f1',
    c2: style.getPropertyValue('--chart-2').trim() || '#10b981',
    c3: style.getPropertyValue('--chart-3').trim() || '#8b5cf6',
    c4: style.getPropertyValue('--chart-4').trim() || '#f59e0b',
    c5: style.getPropertyValue('--chart-5').trim() || '#ec4899',
    grid: style.getPropertyValue('--chart-grid').trim() || '#e2e8f0',
    text: style.getPropertyValue('--chart-text').trim() || '#64748b',
    tooltipBg: style.getPropertyValue('--chart-tooltip-bg').trim() || '#ffffff',
    tooltipBorder: style.getPropertyValue('--chart-tooltip-border').trim() || '#e2e8f0',
  };
}

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
