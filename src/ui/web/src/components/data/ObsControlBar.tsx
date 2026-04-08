import React, { useState, useRef, useCallback } from 'react';
import { clsx } from 'clsx';
import { type Granularity, type TimeRange } from './TimeRangeSelector';

function FilterIcon({ className }: { className?: string }) {
  return (
    <svg className={clsx('w-3 h-3 shrink-0', className)} viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 3.25a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 .53 1.28L9.5 9.06V13a.75.75 0 0 1-1.28.53l-2-2A.75.75 0 0 1 6 11V9.06L1.97 4.53a.75.75 0 0 1-.47-.97V3.25z" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={clsx('w-3 h-3 shrink-0', className)} viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M4.5 1.75a.75.75 0 0 0-1.5 0V3H2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-1V1.75a.75.75 0 0 0-1.5 0V3h-7V1.75zM2.5 7h11V13h-11V7z" />
    </svg>
  );
}

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

const SEG_BTN = 'px-2 py-0.5 text-xs rounded transition-colors whitespace-nowrap';
const SEG_ACTIVE = 'bg-bg-secondary text-text-primary shadow-sm';
const SEG_INACTIVE = 'text-text-muted hover:text-text-primary';
const RANGE_ACTIVE = 'bg-accent text-white';
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
            'mr-2 px-1.5 py-0.5 text-xs rounded border transition-colors',
            expandAll
              ? 'border-accent/40 text-accent bg-accent/5 hover:bg-accent/10'
              : 'border-transparent text-text-muted hover:text-text-secondary hover:border-border-primary'
          )}
        >
          {expandAll ? '−' : '⋯'}
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
                <span className="text-xs text-text-secondary px-1 cursor-default select-none">
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
                <div className="flex items-center gap-1 flex-wrap">
                  {filters}
                  {activeFilterCount > 0 && (
                    <span className="text-xs text-text-muted">({activeFilterCount})</span>
                  )}
                </div>
              ) : (
                <span className="flex items-center gap-1 text-xs text-text-secondary cursor-default select-none px-1">
                  <FilterIcon className="text-text-muted" />
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
                    className={clsx(SEG_BTN, range === p.value ? RANGE_ACTIVE : SEG_INACTIVE)}
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
                        className={clsx(SEG_BTN, granularity === g.value ? SEG_ACTIVE : SEG_INACTIVE)}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <span className="flex items-center gap-1 text-xs text-text-secondary cursor-default select-none px-1">
              <CalendarIcon className="text-text-muted" />
              <span>{rangeLabel}</span>
              {granShort && <span className="text-text-muted">({granShort})</span>}
            </span>
          )}
        </div>
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
        'px-2.5 py-0.5 text-xs rounded border transition-colors',
        active
          ? activeColorClasses[activeColor]
          : 'bg-bg-secondary border-border-primary text-text-muted hover:text-text-secondary hover:bg-bg-tertiary'
      )}
    >
      {label}
    </button>
  );
}
