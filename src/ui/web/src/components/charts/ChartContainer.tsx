import { ResponsiveContainer } from 'recharts';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { Icon } from '../ui/Icon';

/** Consistent card styling for all observability charts. */
export const chartCardClass = 'rounded-lg border border-border-primary bg-bg-secondary p-4';

export function ChartContainer({
  title,
  crumb,
  chip,
  height = 250,
  fill = false,
  raw = false,
  children,
  className,
  chartType,
  onChartTypeChange,
}: {
  title?: string;
  /** Inline meta beside the title — e.g. "Daily · last 30 days · 12,408 calls". */
  crumb?: ReactNode;
  /** Slot for a ChartControlChip; renders next to the chart-type toggle. */
  chip?: ReactNode;
  height?: number;
  fill?: boolean;
  /** When true, renders children directly without wrapping in ResponsiveContainer. */
  raw?: boolean;
  children: ReactNode;
  className?: string;
  chartType?: 'bar' | 'line';
  onChartTypeChange?: (type: 'bar' | 'line') => void;
}) {
  const showToggle = chartType !== undefined && onChartTypeChange !== undefined;
  const hasTitledHeader = !!(title && (crumb || chip));

  return (
    <div className={clsx(chartCardClass, fill && 'flex flex-col', className)}>
      {(title || showToggle || chip) && (
        <div
          className={clsx(
            'flex items-center justify-between gap-3',
            fill ? 'shrink-0' : '',
            hasTitledHeader
              ? 'pb-3 mb-3 border-b border-border-primary'
              : 'mb-3'
          )}
        >
          {title && (
            hasTitledHeader ? (
              <h2 className="font-heading text-base font-medium text-text-primary truncate min-w-0">
                {title}
                {crumb && (
                  <span className="ml-2 text-xs font-sans font-normal text-text-muted">{crumb}</span>
                )}
              </h2>
            ) : (
              <h3 className="font-heading text-lg font-medium text-text-secondary">{title}</h3>
            )
          )}
          {(chip || showToggle) && (
            <div className="flex items-center gap-2 shrink-0">
              {chip}
              {showToggle && (
                <div className="flex items-center gap-0.5 rounded-md border border-border-primary bg-bg-tertiary p-0.5">
                  <button
                    onClick={() => onChartTypeChange('line')}
                    className={clsx(
                      'flex items-center rounded px-1.5 py-1 transition-colors',
                      chartType === 'line'
                        ? 'bg-bg-secondary text-text-primary shadow-sm'
                        : 'text-text-muted hover:text-text-primary'
                    )}
                    title="Line chart"
                  >
                    <Icon name="show_chart" size="sm" />
                  </button>
                  <button
                    onClick={() => onChartTypeChange('bar')}
                    className={clsx(
                      'flex items-center rounded px-1.5 py-1 transition-colors',
                      chartType === 'bar'
                        ? 'bg-bg-secondary text-text-primary shadow-sm'
                        : 'text-text-muted hover:text-text-primary'
                    )}
                    title="Bar chart"
                  >
                    <Icon name="bar_chart" size="sm" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {raw ? (
        children
      ) : fill ? (
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            {children as React.ReactElement}
          </ResponsiveContainer>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          {children as React.ReactElement}
        </ResponsiveContainer>
      )}
    </div>
  );
}
