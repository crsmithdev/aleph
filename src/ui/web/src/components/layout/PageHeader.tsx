import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-6">
      {/* h-14 matches sidebar header — items-center on h1 only so baseline aligns with "Construct" */}
      <div className="h-14 flex items-center gap-3">
        <h1 className="font-heading text-2xl font-bold text-text-primary leading-none flex-1 min-w-0">{title}</h1>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {subtitle && <p className="text-xs text-text-muted mt-2 leading-none">{subtitle}</p>}
    </div>
  );
}
