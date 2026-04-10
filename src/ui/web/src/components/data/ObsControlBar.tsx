import React, { useState, useRef, useCallback } from 'react';
import { clsx } from 'clsx';
import { Icon } from '../ui/Icon';
import { type Granularity, type TimeRange } from './TimeRangeSelector';

const TIME_RANGE_PRESETS: { label: string; value: TimeRange }[] = [
  { label: 'Session', value: 'session' },
  { label: '1h', value: '1h' },
  { label: '1d', value: '1d' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
];

const GRANULARITIES: { label: string; value: Granularity; short: string }[] = [
  { label: 'Hour', value: 'hour', short: 'h' },
  { label: 'Day', value: 'day', short: 'd' },
];

export type DatasetDisplayMode = 'top-n-other' | 'top-n' | 'all';

const DISPLAY_MODES: { label: string; value: DatasetDisplayMode; short: string }[] = [
  { label: 'Top N + Other', value: 'top-n-other', short: `10+` },
  { label: 'Top N', value: 'top-n', short: '10' },
  { label: 'All', value: 'all', short: '∞' },
];

export interface ObsControlBarProps {
  title: React.ReactNode;
  datasets?: { key: string; label: string }[];
  dataset?: string;
  onDatasetChange?: (d: string) => void;
  filters?: React.ReactNode;
  activeFilterCount?: number;
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
  granularity?: Granularity;
  onGranularityChange?: (g: Granularity) => void;
  displayMode?: DatasetDisplayMode;
  onDisplayModeChange?: (m: DatasetDisplayMode) => void;
  displayN?: number;
  onDisplayNChange?: (n: number) => void;
}

const SEG_BTN = 'px-2 py-0.5 text-sm rounded transition-colors whitespace-nowrap';
const SEG_ACTIVE = 'bg-bg-secondary text-text-primary shadow-sm';
const SEG_INACTIVE = 'text-text-muted hover:text-text-primary';
const PIPE = <span className="mx-1 select-none text-sm font-medium" style={{ color: 'var(--text-muted)' }} aria-hidden>|</span>;

function useHoverGroup() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enter = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  }, []);
  const leave = useCallback(() => {
    timer.current = setTimeout(() => setOpen(false), 180);
  }, []);
  return { open, enter, leave } as const;
}

export function ObsControlBar({
  title,
  datasets,
  dataset,
  onDatasetChange,
  filters,
  activeFilterCount = 0,
  range,
  onRangeChange,
  granularity,
  onGranularityChange,
  displayMode,
  onDisplayModeChange,
  displayN = 10,
  onDisplayNChange,
}: ObsControlBarProps) {
  const left = useHoverGroup();   // dataset + filters + options
  const right = useHoverGroup();  // range + granularity

  const hasDataset = !!(datasets?.length && onDatasetChange);
  const hasGranularity = !!(granularity && onGranularityChange);
  const hasFilters = !!filters;
  const hasOptions = !!(displayMode && onDisplayModeChange);

  const granShort = GRANULARITIES.find(g => g.value === granularity)?.short ?? '';
  const rangeLabel = range === 'session' ? 'Sess' : range;

  return (
    <div className="sticky top-0 z-10 h-14 bg-bg-primary flex items-center gap-2 mb-4">
      <div className="flex-1 min-w-0">{title}</div>

      {/* Left group: dataset | filters | options */}
      {(hasDataset || hasFilters || hasOptions) && (
        <div
          className="flex items-center shrink-0"
          onMouseEnter={left.enter}
          onMouseLeave={left.leave}
        >
          {/* Dataset */}
          {hasDataset && (
            <>
              {left.open ? (
                <div className="flex items-center gap-0.5 rounded border border-border-primary bg-bg-tertiary p-0.5">
                  <Icon name="bar_chart" size="xs" className="text-text-muted mx-1" />
                  {datasets!.map(d => (
                    <button
                      key={d.key}
                      onClick={() => onDatasetChange!(d.key)}
                      className={clsx(SEG_BTN, dataset === d.key ? SEG_ACTIVE : SEG_INACTIVE)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="flex items-center gap-1 text-sm text-text-secondary cursor-default select-none px-1">
                  <Icon name="bar_chart" size="xs" className="text-text-muted" />
                  <span>{datasets!.find(d => d.key === dataset)?.label ?? dataset}</span>
                </span>
              )}
              {(hasFilters || hasOptions) && PIPE}
            </>
          )}

          {/* Filters */}
          {hasFilters && (
            <>
              {left.open ? (
                <div className="flex items-center gap-0.5 rounded border border-border-primary bg-bg-tertiary p-0.5">
                  <Icon name="filter_list" size="xs" className="text-text-muted mx-1" />
                  {filters}
                  {activeFilterCount > 0 && (
                    <span className="text-sm text-text-muted px-1">({activeFilterCount})</span>
                  )}
                </div>
              ) : (
                <span className="flex items-center gap-1 text-sm text-text-secondary cursor-default select-none px-1">
                  <Icon name="filter_list" size="xs" className="text-text-muted" />
                  <span>({activeFilterCount})</span>
                </span>
              )}
              {hasOptions && PIPE}
            </>
          )}

          {/* Options */}
          {hasOptions && (
            <>
              {left.open ? (
                <div className="flex items-center gap-0.5 rounded border border-border-primary bg-bg-tertiary p-0.5">
                  <Icon name="tune" size="xs" className="text-text-muted mx-1" />
                  {DISPLAY_MODES.map(m => (
                    <button
                      key={m.value}
                      onClick={() => onDisplayModeChange!(m.value)}
                      className={clsx(SEG_BTN, displayMode === m.value ? SEG_ACTIVE : SEG_INACTIVE)}
                    >
                      {m.label}
                    </button>
                  ))}
                  {displayMode !== 'all' && onDisplayNChange && (
                    <>
                      <span className="text-border-secondary/80 mx-0.5 text-sm font-light select-none" aria-hidden>·</span>
                      <span className="text-sm text-text-muted mx-0.5">N=</span>
                      {[5, 10, 20, 50].map(n => (
                        <button
                          key={n}
                          onClick={() => onDisplayNChange(n)}
                          className={clsx(SEG_BTN, displayN === n ? SEG_ACTIVE : SEG_INACTIVE)}
                        >
                          {n}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              ) : (
                <span className="flex items-center gap-1 text-sm text-text-secondary cursor-default select-none px-1">
                  <Icon name="tune" size="xs" className="text-text-muted" />
                  <span>{displayMode === 'all' ? '∞' : `${displayN}${displayMode === 'top-n-other' ? '+' : ''}`}</span>
                </span>
              )}
            </>
          )}
        </div>
      )}

      <span className="w-1 h-4 rounded-sm shrink-0 mx-0.5" style={{ background: 'var(--text-muted)' }} aria-hidden />

      {/* Right group: range | granularity */}
      <div
        className="flex items-center shrink-0"
        onMouseEnter={right.enter}
        onMouseLeave={right.leave}
      >
        {/* Range */}
        {right.open ? (
          <div className="flex items-center gap-0.5 rounded border border-border-primary bg-bg-tertiary p-0.5">
            <Icon name="calendar_today" size="xs" className="text-text-muted mx-1" />
            {TIME_RANGE_PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => onRangeChange(p.value)}
                className={clsx(SEG_BTN, range === p.value ? SEG_ACTIVE : SEG_INACTIVE)}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="flex items-center gap-1 text-sm text-text-secondary cursor-default select-none px-1">
            <Icon name="calendar_today" size="xs" className="text-text-muted" />
            <span>{rangeLabel}</span>
          </span>
        )}

        {/* Granularity */}
        {hasGranularity && (
          <>
            {PIPE}
            {right.open ? (
              <div className="flex items-center gap-0.5 rounded border border-border-primary bg-bg-tertiary p-0.5">
                <Icon name="schedule" size="xs" className="text-text-muted mx-1" />
                {GRANULARITIES.map(g => (
                  <button
                    key={g.value}
                    onClick={() => onGranularityChange!(g.value)}
                    className={clsx(SEG_BTN, granularity === g.value ? SEG_ACTIVE : SEG_INACTIVE)}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            ) : (
              <span className="flex items-center gap-1 text-sm text-text-secondary cursor-default select-none px-1">
                <Icon name="schedule" size="xs" className="text-text-muted" />
                <span>{granShort === 'h' ? '1h' : '1d'}</span>
              </span>
            )}
          </>
        )}
      </div>

    </div>
  );
}

export type FilterToggleColor = 'default' | 'accent' | 'error' | 'success';

export interface FilterToggleProps {
  label: string;
  active: boolean;
  onToggle: () => void;
  activeColor?: FilterToggleColor;
}

const activeColorClasses: Record<FilterToggleColor, string> = {
  default: 'bg-bg-secondary text-text-primary shadow-sm',
  accent: 'bg-accent text-white',
  error: 'bg-error/10 text-error',
  success: 'bg-success/10 text-success',
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
        'px-2 py-0.5 text-sm rounded transition-colors whitespace-nowrap',
        active
          ? activeColorClasses[activeColor]
          : 'text-text-muted hover:text-text-primary'
      )}
    >
      {label}
    </button>
  );
}
