import { clsx } from 'clsx';
import { Icon } from './Icon';

interface EmptyStateProps {
  icon?: string;
  title: string;
  hint?: string;
  className?: string;
}

/** Empty-state primitive matching the design-system page_chrome reference: a
 *  glyph in a circle, a single sentence, and (optionally) a hint underneath.
 *  No mascots, no full-bleed art — sentences, not illustrations. */
export function EmptyState({ icon, title, hint, className }: EmptyStateProps) {
  return (
    <div className={clsx('bg-bg-secondary border border-border-primary rounded-lg px-6 py-12 text-center', className)}>
      {icon && (
        <div className="mx-auto mb-4 w-12 h-12 rounded-full border border-border-primary flex items-center justify-center text-text-muted">
          <Icon name={icon} size="md" />
        </div>
      )}
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {hint && <p className="mt-1 text-sm text-text-muted max-w-prose mx-auto leading-relaxed">{hint}</p>}
    </div>
  );
}
