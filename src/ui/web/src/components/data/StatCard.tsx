import { clsx } from 'clsx';
import type { ReactNode } from 'react';

function spaceSlashes(s: string): string {
  return s.replace(/\s*\/\s*/g, ' / ');
}

function spaceIfString(value: string | number | ReactNode): string | number | ReactNode {
  return typeof value === 'string' ? spaceSlashes(value) : value;
}

function highlightNumbers(text: string): ReactNode[] {
  return spaceSlashes(text).split(/(\d[\d,.]*[KMBsmh%$]?)/g).map((part, i) =>
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
    <div className={clsx('bg-bg-secondary rounded-lg', compact ? 'p-3' : 'p-4', className)}>
      <div className="font-sans text-xs uppercase tracking-wide text-text-secondary mb-1">{label}</div>
      <div className={clsx('font-heading font-semibold whitespace-nowrap flex items-baseline gap-2', compact ? 'text-3xl' : 'text-5xl', accentColors[accent ?? 'default'])}>
        <span>{spaceIfString(value)}</span>
        {valueLabel && <span className="font-sans text-sm font-normal text-text-muted">{valueLabel}</span>}
      </div>
      {secondary && (
        <div className={clsx('font-heading font-semibold whitespace-nowrap flex items-baseline gap-2 mt-0.5 leading-tight', accentColors[secondary.accent ?? 'neutral'])} style={{ fontSize: 18 }}>
          <span>{spaceIfString(secondary.value)}</span>
          {secondary.label && <span className="font-sans text-sm font-normal text-text-muted">{secondary.label}</span>}
        </div>
      )}
      {detailContent && <div className="mt-1 text-xs text-text-muted">{detailContent}</div>}
      {!detailContent && detail && <div className="mt-1 text-xs text-text-muted">{highlightNumbers(detail)}</div>}
    </div>
  );
}
