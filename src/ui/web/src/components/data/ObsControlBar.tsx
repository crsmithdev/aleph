import React from 'react';
import { clsx } from 'clsx';
import { TimeRangeSelector, type Granularity, type TimeRange } from './TimeRangeSelector';

export interface ObsControlBarProps {
  title: React.ReactNode;
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
  granularity?: Granularity;
  onGranularityChange?: (g: Granularity) => void;
  children?: React.ReactNode;
}

export function ObsControlBar({
  title,
  range,
  onRangeChange,
  granularity,
  onGranularityChange,
  children,
}: ObsControlBarProps) {
  return (
    <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-bg-primary flex items-center gap-3">
      <div className="flex-1 min-w-0">{title}</div>
      {children && <div className="flex items-center gap-2 flex-wrap shrink-0">{children}</div>}
      <div className="shrink-0">
        <TimeRangeSelector
          value={range}
          onChange={onRangeChange}
          granularity={granularity}
          onGranularityChange={onGranularityChange}
        />
      </div>
    </div>
  );
}

export type FilterToggleColor = 'default' | 'error' | 'success';

export interface FilterToggleProps {
  label: string;
  active: boolean;
  onToggle: () => void;
  activeColor?: FilterToggleColor;
}

const activeColorClasses: Record<FilterToggleColor, string> = {
  default: 'bg-bg-tertiary border-border-primary text-text-primary',
  error: 'bg-error/10 border-error text-error',
  success: 'bg-success/10 border-success text-success',
};

export function FilterToggle({
  label,
  active,
  onToggle,
  activeColor = 'default',
}: FilterToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={clsx(
        'px-3 py-1 text-xs rounded-md border transition-colors',
        active
          ? activeColorClasses[activeColor]
          : 'bg-bg-secondary border-border-primary text-text-muted hover:text-text-secondary hover:bg-bg-tertiary'
      )}
    >
      {label}
    </button>
  );
}
