import React, { useState, useEffect, type ReactNode } from 'react';
import { clsx } from 'clsx';

export interface Column<T> {
  key: string;
  label: string;
  tooltip?: string;
  align?: 'left' | 'center' | 'right';
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
  pageSize?: number;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
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
  pageSize,
  defaultSort,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSort?.key ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSort?.dir ?? 'desc');
  const [currentPage, setCurrentPage] = useState(1);

  // Reset to page 1 when data length changes
  useEffect(() => {
    setCurrentPage(1);
  }, [data.length]);

  // Reset to page 1 when sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [sortKey, sortDir]);

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

  let totalPages = 1;
  if (pageSize) {
    totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(currentPage, totalPages);
    rows = rows.slice((page - 1) * pageSize, page * pageSize);
  } else if (maxRows) {
    rows = rows.slice(0, maxRows);
  }

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-text-muted">{emptyMessage}</p>;
  }

  const effectivePage = Math.min(currentPage, totalPages);

  return (
    <div className={clsx('overflow-x-auto border-t border-border-primary', className)}>
      <table className="w-full text-base">
        <thead>
          <tr className="border-b border-border-primary bg-bg-secondary">
            {columns.map((col) => (
              <th
                key={col.key}
                className={clsx(
                  'px-4 py-2.5 font-sans text-xs uppercase tracking-widest text-text-muted whitespace-nowrap',
                  col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                  col.sortable && 'cursor-pointer select-none hover:text-text-secondary'
                )}
                style={col.shrink ? { width: '1px' } : col.width ? { width: col.width } : { width: '100%' }}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
                title={col.tooltip}
              >
                <span className={clsx('inline-flex items-center gap-1', col.tooltip && 'underline decoration-dotted decoration-text-disabled underline-offset-[3px]')}>
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
                        'px-4 py-2.5 align-middle whitespace-nowrap',
                        col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                        (col.width || (!col.shrink && !col.width)) && 'overflow-hidden text-ellipsis'
                      )}
                      style={col.shrink ? { width: '1px' } : col.width ? { width: col.width, maxWidth: col.width } : { width: '100%', maxWidth: 0 }}
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
      {pageSize && totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border-primary bg-bg-secondary/50">
          <span className="text-xs text-text-muted">
            Page {effectivePage} of {totalPages} &middot; {data.length} total
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={effectivePage <= 1}
              className="px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={effectivePage >= totalPages}
              className="px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
