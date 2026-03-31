import { useState } from 'react';
import { ResponsiveContainer } from 'recharts';
import { cn } from '../../utils/cn';
import type { ReactNode } from 'react';

function BarChartIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="7" width="3" height="8" rx="0.5" fill="currentColor" fillOpacity={active ? 1 : 0.4} />
      <rect x="6" y="4" width="3" height="11" rx="0.5" fill="currentColor" fillOpacity={active ? 1 : 0.4} />
      <rect x="11" y="1" width="3" height="14" rx="0.5" fill="currentColor" fillOpacity={active ? 1 : 0.4} />
    </svg>
  );
}

function LineChartIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <polyline
        points="1,13 5,7 9,10 13,3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={active ? 1 : 0.4}
        fill="none"
      />
      <circle cx="1" cy="13" r="1.5" fill="currentColor" fillOpacity={active ? 1 : 0.4} />
      <circle cx="5" cy="7" r="1.5" fill="currentColor" fillOpacity={active ? 1 : 0.4} />
      <circle cx="9" cy="10" r="1.5" fill="currentColor" fillOpacity={active ? 1 : 0.4} />
      <circle cx="13" cy="3" r="1.5" fill="currentColor" fillOpacity={active ? 1 : 0.4} />
    </svg>
  );
}

export function useChartType(defaultType: 'bar' | 'line' = 'line') {
  const [chartType, setChartType] = useState<'bar' | 'line'>(defaultType);
  return { chartType, setChartType };
}

export function ChartContainer({
  title,
  height = 250,
  children,
  className,
  chartType,
  onChartTypeChange,
}: {
  title?: string;
  height?: number;
  children: ReactNode;
  className?: string;
  chartType?: 'bar' | 'line';
  onChartTypeChange?: (type: 'bar' | 'line') => void;
}) {
  const showToggle = chartType !== undefined && onChartTypeChange !== undefined;

  return (
    <div className={cn('rounded-lg border border-border-primary bg-bg-secondary p-4', className)}>
      {(title || showToggle) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h3 className="text-sm font-medium text-text-secondary">{title}</h3>}
          {showToggle && (
            <div className="flex items-center gap-0.5 rounded-md border border-border-primary bg-bg-tertiary p-0.5">
              <button
                onClick={() => onChartTypeChange('line')}
                className={cn(
                  'flex items-center rounded px-1.5 py-1 text-text-muted transition-colors hover:text-text-primary',
                  chartType === 'line' && 'bg-bg-secondary text-text-primary shadow-sm'
                )}
                title="Line chart"
              >
                <LineChartIcon active={chartType === 'line'} />
              </button>
              <button
                onClick={() => onChartTypeChange('bar')}
                className={cn(
                  'flex items-center rounded px-1.5 py-1 text-text-muted transition-colors hover:text-text-primary',
                  chartType === 'bar' && 'bg-bg-secondary text-text-primary shadow-sm'
                )}
                title="Bar chart"
              >
                <BarChartIcon active={chartType === 'bar'} />
              </button>
            </div>
          )}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}
