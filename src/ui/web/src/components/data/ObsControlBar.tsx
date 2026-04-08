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
}

const SEG_BTN = 'px-2 py-0.5 text-sm rounded transition-colors whitespace-nowrap';
const SEG_ACTIVE = 'bg-bg-secondary text-text-primary shadow-sm';
const SEG_INACTIVE = 'text-text-muted hover:text-text-primary';
const ACCENT_ACTIVE = 'bg-accent text-white';
const PIPE = <span className="mx-2 text-border-secondary/80 select-none text-sm font-light" aria-hidden>|</span>;

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
}: ObsControlBarProps) {
  const [expandAll, setExpandAll] = useState(false);
  const [openSegment, setOpenSegment] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openSeg = useCallback((seg: string) => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setOpenSegment(seg);
  }, []);

  const closeSeg = useCallback(() => {
    closeTimerRef.current = setTimeout(() => setOpenSegment(null), 120);
  }, []);

  const isOpen = (seg: string) => expandAll || openSegment === seg;

  const hasDataset = !!(datasets?.length && onDatasetChange);
  const hasGranularity = !!(granularity && onGranularityChange);
  const hasFilters = !!filters;

  const granShort = GRANULARITIES.find(g => g.value === granularity)?.short ?? '';
  const rangeLabel = range === 'session' ? 'Sess' : range;

  return (
    <div className="sticky top-0 z-10 h-11 bg-bg-primary flex items-center gap-2 mb-4">
      <div className="flex-1 min-w-0">{title}</div>

      <div className="flex items-center shrink-0">
        {/* Expand / Collapse all toggle */}
        <button
          onClick={() => setExpandAll(v => !v)}
          title={expandAll ? 'Collapse all' : 'Expand all'}
          className={clsx(
            'mr-2 px-1.5 py-0.5 text-sm rounded border transition-colors',
            expandAll
              ? 'border-accent/40 text-accent bg-accent/5 hover:bg-accent/10'
              : 'border-transparent text-text-muted hover:text-text-secondary hover:border-border-primary'
          )}
        >
          <Icon name={expandAll ? 'remove' : 'add'} size="xs" />
        </button>

        {/* Dataset segment */}
        {hasDataset && (
          <>
            <div
              className="flex items-center"
              onMouseEnter={() => openSeg('dataset')}
              onMouseLeave={closeSeg}
            >
              {isOpen('dataset') ? (
                <div className="flex items-center gap-0.5 rounded border border-border-primary bg-bg-tertiary p-0.5">
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
                <span className="text-sm text-text-secondary px-1 cursor-default select-none">
                  {datasets!.find(d => d.key === dataset)?.label ?? dataset}
                </span>
              )}
            </div>
            {PIPE}
          </>
        )}

        {/* Filter segment */}
        {hasFilters && (
          <>
            <div
              className="flex items-center"
              onMouseEnter={() => openSeg('filters')}
              onMouseLeave={closeSeg}
            >
              {isOpen('filters') ? (
                <div className="flex items-center gap-0.5 rounded border border-border-primary bg-bg-tertiary p-0.5">
                  {filters}
                  {activeFilterCount > 0 && (
                    <span className="text-sm text-text-muted px-1">({activeFilterCount})</span>
                  )}
                </div>
              ) : (
                <span className="flex items-center gap-1 text-sm text-text-secondary cursor-default select-none px-1">
                  <Icon name="filter_list" size="xs" className="text-text-muted" />
                  <span className="text-text-muted">({activeFilterCount})</span>
                </span>
              )}
            </div>
            {PIPE}
          </>
        )}

        {/* Range + Interval segment */}
        <div
          className="flex items-center"
          onMouseEnter={() => openSeg('range')}
          onMouseLeave={closeSeg}
        >
          {isOpen('range') ? (
            <div className="flex items-center gap-1">
              <div className="flex items-center gap-0.5 rounded border border-border-primary bg-bg-tertiary p-0.5">
                {TIME_RANGE_PRESETS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => onRangeChange(p.value)}
                    className={clsx(SEG_BTN, range === p.value ? ACCENT_ACTIVE : SEG_INACTIVE)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {hasGranularity && (
                <>
                  {PIPE}
                  <div className="flex items-center gap-0.5 rounded border border-border-primary bg-bg-tertiary p-0.5">
                    {GRANULARITIES.map(g => (
                      <button
                        key={g.value}
                        onClick={() => onGranularityChange!(g.value)}
                        className={clsx(SEG_BTN, granularity === g.value ? ACCENT_ACTIVE : SEG_INACTIVE)}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <span className="flex items-center gap-1 text-sm text-text-secondary cursor-default select-none px-1">
              <Icon name="calendar_today" size="xs" className="text-text-muted" />
              <span>{rangeLabel}</span>
              {granShort && <span className="text-text-muted">({granShort})</span>}
            </span>
          )}
        </div>
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
