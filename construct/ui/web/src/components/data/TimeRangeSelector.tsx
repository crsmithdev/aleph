import { cn } from '../../utils/cn';

const presets = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
] as const;

export function TimeRangeSelector({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (days: number) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-1', className)}>
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
  );
}
