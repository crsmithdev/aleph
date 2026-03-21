import { cn } from '../../utils/cn';

const presets = [
  { label: '1d', value: 1 },
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
] as const;

export type Granularity = 'minute' | 'hour' | 'day';

const granularities: { label: string; value: Granularity }[] = [
  { label: 'Min', value: 'minute' },
  { label: 'Hour', value: 'hour' },
  { label: 'Day', value: 'day' },
];

export function TimeRangeSelector({
  value,
  onChange,
  granularity,
  onGranularityChange,
  className,
}: {
  value: number;
  onChange: (days: number) => void;
  granularity?: Granularity;
  onGranularityChange?: (g: Granularity) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {onGranularityChange && granularity && (
        <div className="flex gap-1 border-r border-border-primary pr-3">
          {granularities.map((g) => (
            <button
              key={g.value}
              onClick={() => onGranularityChange(g.value)}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                granularity === g.value
                  ? 'bg-bg-tertiary text-text-primary'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary/50'
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-1">
        {presets.map((p) => (
          <button
            key={p.value}
            onClick={() => onChange(p.value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              value === p.value
                ? 'bg-accent text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
