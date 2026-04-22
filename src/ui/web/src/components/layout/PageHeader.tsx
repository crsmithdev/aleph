import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { clsx } from 'clsx';

const TITLE_BASE = 'font-heading text-2xl font-bold leading-tight';

export function PageTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h1 className={clsx(TITLE_BASE, 'text-text-primary truncate min-w-0 flex-1', className)}>{children}</h1>;
}

export function PageTitleLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink to={to} className={clsx(TITLE_BASE, 'text-text-muted hover:text-text-primary transition-colors whitespace-nowrap shrink-0')}>
      {children}
    </NavLink>
  );
}

export function PageTitleSeparator() {
  return <span className={clsx(TITLE_BASE, 'text-text-muted shrink-0')} aria-hidden>&raquo;</span>;
}

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  const titleNode = typeof title === 'string' ? <PageTitle>{title}</PageTitle> : title;
  return (
    <div className="mb-6">
      <div className="h-14 flex items-center gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">{titleNode}</div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {subtitle && <p className="text-xs text-text-muted mt-2 leading-tight">{subtitle}</p>}
    </div>
  );
}
