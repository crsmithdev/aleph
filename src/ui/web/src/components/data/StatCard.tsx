import { clsx } from 'clsx';
import type { ReactNode } from 'react';

function highlightNumbers(text: string): ReactNode[] {
  return text.split(/(\d[\d,.]*[KMBsmh%$]?)/g).map((part, i) =>
    /^\d/.test(part)
      ? <span key={i} className="text-text-secondary font-medium">{part}</span>
      : <span key={i}>{part}</span>
  );
}

const accentColors: Record<'default' | 'neutral' | 'success' | 'warning' | 'error', string> = {
  default: 'text-accent',
  neutral: 'text-text-primary',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
};

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
  accent?: 'default' | 'neutral' | 'success' | 'warning' | 'error';
  className?: string;
}) {

  return (
    <div className={clsx('border-t-2 border-border-primary pt-4', className)}>
      <div className="font-sans text-xs uppercase tracking-wide text-text-muted mb-1">{label}</div>
      <div className={clsx('font-mono text-5xl font-medium tracking-tight whitespace-nowrap', accentColors[accent ?? 'default'])}>
        {value}
      </div>
      {detailContent && <div className="mt-1 text-xs text-text-muted">{detailContent}</div>}
      {!detailContent && detail && <div className="mt-1 text-xs text-text-muted">{highlightNumbers(detail)}</div>}
    </div>
  );
}
