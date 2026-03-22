import { useState, type ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  width?: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyField: keyof T;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  emptyMessage?: string;
  className?: string;
  maxRows?: number;
}

export function DataTable<T>({
  data,
  columns,
  keyField,
  onRowClick,
  rowClassName,
  emptyMessage = 'No data',
  className,
  maxRows,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  let rows = [...data];
  if (sortKey) {
    rows.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey];
      const bv = (b as Record<string, unknown>)[sortKey];
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }
  if (maxRows) rows = rows.slice(0, maxRows);

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-text-muted">{emptyMessage}</p>;
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border-primary', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-primary bg-bg-secondary">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'px-4 py-2.5 text-xs font-medium text-text-muted',
                  col.align === 'right' ? 'text-right' : 'text-left',
                  col.sortable && 'cursor-pointer select-none hover:text-text-secondary'
                )}
                style={col.width ? { width: col.width } : undefined}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {col.sortable && sortKey === col.key && (
                    <span className="text-[10px]">{sortDir === 'asc' ? '\u25b2' : '\u25bc'}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={String(row[keyField])}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b border-border-primary/50 transition-colors',
                onRowClick && 'cursor-pointer hover:bg-bg-tertiary',
                rowClassName?.(row)
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-4 py-2.5',
                    col.align === 'right' ? 'text-right' : 'text-left'
                  )}
                >
                  {col.render
                    ? col.render(row)
                    : String((row as Record<string, unknown>)[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
