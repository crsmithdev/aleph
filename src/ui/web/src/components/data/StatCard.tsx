import { cn } from '../../utils/cn';

export function StatCard({
  label,
  value,
  detail,
  accent,
  className,
}: {
  label: string;
  value: string | number;
  detail?: string;
  accent?: 'default' | 'success' | 'warning' | 'error';
  className?: string;
}) {
  const accentColors = {
    default: 'text-accent',
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-error',
  };

  return (
    <div className={cn('rounded-lg border border-border-primary bg-bg-secondary p-4', className)}>
      <div className={cn('text-2xl font-semibold tracking-tight', accentColors[accent ?? 'default'])}>
        {value}
      </div>
      <div className="mt-1 text-xs text-text-muted">{label}</div>
      {detail && <div className="mt-0.5 text-xs text-text-muted">{detail}</div>}
    </div>
  );
}
