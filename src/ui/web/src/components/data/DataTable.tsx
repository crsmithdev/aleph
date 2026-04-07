import React, { useState, type ReactNode } from 'react';
import { clsx } from 'clsx';

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  width?: string;
  shrink?: boolean;  // collapse column to minimum content width (no wrapping)
  render?: (row: T) => ReactNode;
  sortable?: boolean;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyField: keyof T;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  expandedKey?: string | null;
  onExpandToggle?: (key: string | null) => void;
  renderExpanded?: (row: T) => ReactNode;
  rowKeyFn?: (row: T) => string;
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
  expandedKey,
  onExpandToggle,
  renderExpanded,
  rowKeyFn,
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
    <div className={clsx('overflow-hidden border-t border-border-primary', className)}>
      <table className="w-full text-base">
        <thead>
          <tr className="border-b border-border-primary bg-bg-secondary">
            {columns.map((col) => (
              <th
                key={col.key}
                className={clsx(
                  'px-4 py-2.5 font-sans text-xs uppercase tracking-widest text-text-muted',
                  col.align === 'right' ? 'text-right' : 'text-left',
                  col.sortable && 'cursor-pointer select-none hover:text-text-secondary',
                  col.shrink && 'whitespace-nowrap'
                )}
                style={col.shrink ? { width: '1px' } : col.width ? { width: col.width } : undefined}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {col.sortable && sortKey === col.key && (
                    <span className="text-xs">{sortDir === 'asc' ? '\u25b2' : '\u25bc'}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rowKey = rowKeyFn ? rowKeyFn(row) : String(row[keyField]);
            const isExpanded = renderExpanded && expandedKey === rowKey;
            const handleClick = onExpandToggle
              ? () => onExpandToggle(isExpanded ? null : rowKey)
              : onRowClick
                ? () => onRowClick(row)
                : undefined;

            return (
              <React.Fragment key={rowKey}>
                <tr
                  data-row-key={rowKey}
                  onClick={handleClick}
                  className={clsx(
                    'border-b border-border-primary/50 transition-colors',
                    index % 2 === 1 && 'bg-bg-secondary/30',
                    (onRowClick || onExpandToggle) && 'cursor-pointer hover:bg-bg-tertiary',
                    isExpanded && 'bg-bg-tertiary/50',
                    rowClassName?.(row)
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={clsx(
                        'px-4 py-2.5 align-middle',
                        col.align === 'right' ? 'text-right' : 'text-left',
                        col.shrink && 'whitespace-nowrap'
                      )}
                      style={col.shrink ? { width: '1px' } : col.width ? { width: col.width, maxWidth: col.width } : undefined}
                    >
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
                {isExpanded && (
                  <tr className="border-b border-border-primary/50 bg-bg-secondary/50">
                    <td colSpan={columns.length} className="px-4 py-3">
                      {renderExpanded(row)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
