import { cn } from '../../utils/cn';
import type { ReactNode } from 'react';

function highlightNumbers(text: string): ReactNode[] {
  return text.split(/(\d[\d,.]*[KMBsmh%$]?)/g).map((part, i) =>
    /^\d/.test(part)
      ? <span key={i} className="text-text-secondary font-medium">{part}</span>
      : <span key={i}>{part}</span>
  );
}

export function StatCard({
  label,
  value,
  detail,
  detailContent,
  accent,
  className,
}: {
  label: string;
  value: string | number | ReactNode;
  detail?: string;
  detailContent?: ReactNode;
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
      <div className="text-[11px] uppercase tracking-wider font-medium text-text-muted mb-1">{label}</div>
      <div className={cn('text-3xl font-semibold tracking-tight', accentColors[accent ?? 'default'])}>
        {value}
      </div>
      {detailContent && <div className="mt-1 text-xs text-text-muted">{detailContent}</div>}
      {!detailContent && detail && <div className="mt-1 text-xs text-text-muted">{highlightNumbers(detail)}</div>}
    </div>
  );
}
