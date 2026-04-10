import { clsx } from 'clsx';
import type { ReactNode } from 'react';

function highlightNumbers(text: string): ReactNode[] {
  return text.split(/(\d[\d,.]*[KMBsmh%$]?)/g).map((part, i) =>
    /^\d/.test(part)
      ? <span key={i} className="text-text-secondary font-medium">{part}</span>
      : <span key={i}>{part}</span>
  );
}

type Accent = 'default' | 'neutral' | 'success' | 'warning' | 'error';

const accentColors: Record<Accent, string> = {
  default: 'text-accent',
  neutral: 'text-text-primary',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
};

export function StatCard({
  label,
  value,
  valueLabel,
  secondary,
  detail,
  detailContent,
  accent,
  compact,
  className,
}: {
  label: string;
  value: string | number | ReactNode;
  valueLabel?: string;
  secondary?: { value: ReactNode; label?: string; accent?: Accent };
  detail?: string;
  detailContent?: ReactNode;
  accent?: Accent;
  compact?: boolean;
  className?: string;
}) {

  return (
    <div className={clsx('border-t-2 border-border-primary', compact ? 'pt-3' : 'pt-4', className)}>
      <div className="font-sans text-xs uppercase tracking-wide text-text-secondary mb-1">{label}</div>
      <div className={clsx('font-heading font-semibold tracking-tight whitespace-nowrap flex items-baseline gap-2', compact ? 'text-3xl' : 'text-5xl', accentColors[accent ?? 'default'])}>
        <span>{value}</span>
        {valueLabel && <span className="font-sans text-sm font-normal text-text-muted">{valueLabel}</span>}
      </div>
      {secondary && (
        <div className={clsx('font-heading font-semibold tracking-tight whitespace-nowrap flex items-baseline gap-2 mt-0.5 leading-tight', accentColors[secondary.accent ?? 'neutral'])} style={{ fontSize: 18 }}>
          <span>{secondary.value}</span>
          {secondary.label && <span className="font-sans text-sm font-normal text-text-muted">{secondary.label}</span>}
        </div>
      )}
      {detailContent && <div className="mt-1 text-xs text-text-muted">{detailContent}</div>}
      {!detailContent && detail && <div className="mt-1 text-xs text-text-muted">{highlightNumbers(detail)}</div>}
    </div>
  );
}
