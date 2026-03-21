import { ResponsiveContainer } from 'recharts';
import { cn } from '../../utils/cn';
import type { ReactNode } from 'react';

export function ChartContainer({
  title,
  height = 250,
  children,
  className,
}: {
  title?: string;
  height?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-border-primary bg-bg-secondary p-4', className)}>
      {title && (
        <h3 className="mb-3 text-sm font-medium text-text-secondary">{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={height}>
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}
