import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
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

const GRANULARITIES: { label: string; value: Granularity }[] = [
  { label: 'Hour', value: 'hour' },
  { label: 'Day', value: 'day' },
];

export type DatasetDisplayMode = 'top-n-other' | 'top-n' | 'all';

const DISPLAY_MODES: { label: string; value: DatasetDisplayMode }[] = [
  { label: 'Top N + Other', value: 'top-n-other' },
  { label: 'Top N', value: 'top-n' },
  { label: 'All', value: 'all' },
];

export interface ChartControlChipProps {
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
  granularity?: Granularity;
  onGranularityChange?: (g: Granularity) => void;
  datasets?: { key: string; label: string }[];
  dataset?: string;
  onDatasetChange?: (d: string) => void;
  filters?: React.ReactNode;
  activeFilterCount?: number;
  displayMode?: DatasetDisplayMode;
  onDisplayModeChange?: (m: DatasetDisplayMode) => void;
  displayN?: number;
  onDisplayNChange?: (n: number) => void;
  /** Used for the third fragment summary when a dataset is active */
  totalSeries?: number;
  className?: string;
}

const SEG_BTN = 'px-2 py-0.5 text-xs rounded-sm transition-colors whitespace-nowrap';
const SEG_ACTIVE = 'bg-bg-secondary text-text-primary shadow-sm';
const SEG_INACTIVE = 'text-text-muted hover:text-text-primary';

function rangeShort(r: TimeRange): string {
  return r === 'session' ? 'sess' : r;
}

export function ChartControlChip(props: ChartControlChipProps) {
  const {
    range, onRangeChange,
    granularity, onGranularityChange,
    datasets, dataset, onDatasetChange,
    filters, activeFilterCount = 0,
    displayMode, onDisplayModeChange,
    displayN = 10, onDisplayNChange,
    totalSeries,
    className,
  } = props;

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Position popover under the chip, right-aligned
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    function onScroll() {
      if (!triggerRef.current) return;
      const rr = triggerRef.current.getBoundingClientRect();
      setPos({ top: rr.bottom + 6, right: window.innerWidth - rr.right });
    }
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const hasDataset = !!(datasets?.length && onDatasetChange);
  const hasFilters = !!filters;
  const hasOptions = !!(displayMode && onDisplayModeChange);

  const datasetLabel = hasDataset ? (datasets!.find(d => d.key === dataset)?.label ?? dataset) : null;
  const seriesCount = totalSeries != null
    ? (displayMode === 'all' ? totalSeries : Math.min(displayN, totalSeries))
    : null;
  const otherMarker = displayMode === 'top-n-other' && totalSeries != null && totalSeries > displayN ? '+' : '';
  const seriesFragment = hasDataset
    ? (seriesCount != null ? `${datasetLabel} #${seriesCount}${otherMarker}` : datasetLabel)
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'inline-flex items-stretch overflow-hidden rounded-md border bg-bg-tertiary font-mono text-xs text-text-secondary transition-colors',
          open ? 'border-accent' : 'border-border-primary hover:border-border-secondary',
          className
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="flex items-center gap-1.5 px-2.5 py-1 border-r border-border-primary">
          <Icon name="calendar_today" size="xs" className="text-text-muted" />
          {rangeShort(range)}
        </span>
        {granularity && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 border-r border-border-primary">
            <Icon name="schedule" size="xs" className="text-text-muted" />
            {granularity}
          </span>
        )}
        {seriesFragment && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 border-r border-border-primary">
            <Icon name="stacked_line_chart" size="xs" className="text-text-muted" />
            {seriesFragment}
          </span>
        )}
        {hasFilters && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 border-r border-border-primary">
            <Icon name="filter_list" size="xs" className="text-text-muted" />
            {activeFilterCount}
          </span>
        )}
        <span className="flex items-center px-1.5 py-1 bg-bg-secondary text-text-muted">
          <Icon name={open ? 'expand_less' : 'expand_more'} size="xs" />
        </span>
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          className="fixed z-50 w-[380px] rounded-md border border-border-secondary bg-bg-secondary shadow-[0_10px_28px_rgba(0,0,0,0.45),0_2px_6px_rgba(0,0,0,0.25)]"
          style={{ top: pos.top, right: pos.right }}
        >
          {/* Range */}
          <PopSection icon="calendar_today" label="Range">
            <div className="inline-flex flex-wrap gap-0.5 rounded-md border border-border-primary bg-bg-tertiary p-0.5">
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
          </PopSection>

          {granularity && onGranularityChange && (
            <PopSection icon="schedule" label="Granularity">
              <div className="inline-flex gap-0.5 rounded-md border border-border-primary bg-bg-tertiary p-0.5">
                {GRANULARITIES.map(g => (
                  <button
                    key={g.value}
                    onClick={() => onGranularityChange(g.value)}
                    className={clsx(SEG_BTN, granularity === g.value ? SEG_ACTIVE : SEG_INACTIVE)}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </PopSection>
          )}

          {hasDataset && (
            <PopSection icon="stacked_line_chart" label="Series" hint={totalSeries != null ? `${totalSeries} total` : undefined}>
              <div className="flex flex-wrap gap-0.5 rounded-md border border-border-primary bg-bg-tertiary p-0.5 mb-2">
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
              {hasOptions && (
                <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-border-primary bg-bg-tertiary p-0.5">
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
                      <span className="mx-1 h-3 w-px bg-border-primary" />
                      <span className="text-text-muted text-xs px-1">N</span>
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
              )}
            </PopSection>
          )}

          {hasFilters && (
            <PopSection icon="filter_list" label="Filters" hint={activeFilterCount > 0 ? `${activeFilterCount} active` : undefined}>
              <div className="flex flex-wrap gap-1">
                {filters}
              </div>
            </PopSection>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

function PopSection({
  icon,
  label,
  hint,
  children,
}: {
  icon: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-3 py-2.5 border-b border-border-primary last:border-b-0">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon name={icon} size="xs" className="text-text-muted" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">{label}</span>
        {hint && <span className="ml-auto text-[10px] text-text-disabled font-sans normal-case tracking-normal">{hint}</span>}
      </div>
      {children}
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
  default: 'bg-bg-tertiary text-text-primary border-border-secondary',
  accent: 'bg-accent text-white border-accent',
  error: 'bg-error/10 text-error border-error/30',
  success: 'bg-success/10 text-success border-success/30',
};

export function FilterToggle({
  label,
  active,
  onToggle,
  activeColor = 'default',
}: FilterToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        'rounded-md border px-2 py-0.5 text-xs whitespace-nowrap transition-colors',
        active
          ? activeColorClasses[activeColor]
          : 'border-dashed border-border-primary text-text-muted hover:text-text-primary hover:border-border-secondary'
      )}
    >
      {label}
    </button>
  );
}
