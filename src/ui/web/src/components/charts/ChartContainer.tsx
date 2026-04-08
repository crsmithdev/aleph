import { ResponsiveContainer } from 'recharts';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { Icon } from '../ui/Icon';

export function ChartContainer({
  title,
  height = 250,
  fill = false,
  children,
  className,
  chartType,
  onChartTypeChange,
}: {
  title?: string;
  height?: number;
  fill?: boolean;
  children: ReactNode;
  className?: string;
  chartType?: 'bar' | 'line';
  onChartTypeChange?: (type: 'bar' | 'line') => void;
}) {
  const showToggle = chartType !== undefined && onChartTypeChange !== undefined;

  return (
    <div className={clsx('rounded-lg border border-border-primary bg-bg-secondary p-4', fill && 'flex flex-col', className)}>
      {(title || showToggle) && (
        <div className={clsx('flex items-center justify-between', fill ? 'mb-3 shrink-0' : 'mb-3')}>
          {title && <h3 className="text-sm font-medium text-text-secondary">{title}</h3>}
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
      {fill ? (
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
