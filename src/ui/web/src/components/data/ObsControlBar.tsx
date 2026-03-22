import React from 'react';
import { cn } from '../../utils/cn';
import { TimeRangeSelector, type Granularity } from './TimeRangeSelector';

export interface ObsControlBarProps {
  days: number;
  onDaysChange: (days: number) => void;
  granularity?: Granularity;
  onGranularityChange?: (g: Granularity) => void;
  children?: React.ReactNode;
}

export function ObsControlBar({
  days,
  onDaysChange,
  granularity,
  onGranularityChange,
  children,
}: ObsControlBarProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">{children}</div>
      <TimeRangeSelector
        value={days}
        onChange={onDaysChange}
        granularity={granularity}
        onGranularityChange={onGranularityChange}
      />
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
      className={cn(
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
