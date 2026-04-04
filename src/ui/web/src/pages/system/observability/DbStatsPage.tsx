import { useState } from 'react';
import { useObsDbStats, useObsDbSchema, useObsDbContents } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { fmtNumber, fmtBytes } from '../../../utils/format';
import { clsx } from 'clsx';
type TableRow = { name: string; rows: number };

function SchemaView({ db, table }: { db: string; table: string }) {
  const { data, isLoading, error } = useObsDbSchema(db, table);

  if (isLoading) return <span className="text-xs text-text-muted font-mono">Loading schema...</span>;
  if (error || !data || data.columns.length === 0) return <span className="text-xs text-text-muted">No schema available</span>;

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-text-muted">
          <th className="text-left py-1 pr-4 font-medium">Column</th>
          <th className="text-left py-1 pr-4 font-medium">Type</th>
          <th className="text-left py-1 pr-4 font-medium">Constraints</th>
        </tr>
      </thead>
      <tbody>
        {data.columns.map((col) => (
          <tr key={col.name} className="border-t border-border-primary/30">
            <td className="py-1 pr-4 font-mono text-text-primary">{col.name}</td>
            <td className={clsx('py-1 pr-4 font-mono', 'text-text-secondary')}>{col.type || 'any'}</td>
            <td className="py-1 pr-4 text-text-muted">
              {col.pk && <span className="mr-2 text-accent font-medium">PK</span>}
              {col.notnull && <span className="mr-2">NOT NULL</span>}
              {col.defaultValue !== null && <span>default: {col.defaultValue}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ContentsView({ db, table }: { db: string; table: string }) {
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const { data, isLoading, error } = useObsDbContents(db, table, limit, offset);

  if (isLoading) return <span className="text-xs text-text-muted font-mono">Loading...</span>;
  if (error || !data) return <span className="text-xs text-error">Failed to load contents</span>;
  if (data.rows.length === 0) return <span className="text-xs text-text-muted italic">No rows</span>;

  const columns = Object.keys(data.rows[0]);
  const totalPages = Math.ceil(data.total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text-muted border-b border-border-primary/30">
              {columns.map((col) => (
                <th key={col} className="text-left py-1 pr-4 font-medium whitespace-nowrap">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i} className="border-b border-border-primary/20 hover:bg-bg-tertiary/30">
                {columns.map((col) => {
                  const val = row[col];
                  const str = val === null ? 'NULL' : typeof val === 'string' && val.length > 80 ? val.slice(0, 80) + '…' : String(val ?? '');
                  return (
                    <td key={col} className={clsx('py-1 pr-4 font-mono max-w-xs truncate', val === null ? 'text-text-disabled italic' : 'text-text-secondary')} title={String(val ?? '')}>
                      {str}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.total > limit && (
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="px-2 py-0.5 rounded border border-border-primary hover:bg-bg-tertiary disabled:opacity-40 transition-colors"
          >
            ←
          </button>
          <span>Page {currentPage} of {totalPages} ({fmtNumber(data.total)} rows)</span>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={offset + limit >= data.total}
            className="px-2 py-0.5 rounded border border-border-primary hover:bg-bg-tertiary disabled:opacity-40 transition-colors"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}

function DbTableList({ dbName, tables }: { dbName: string; tables: TableRow[] }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'schema' | 'contents'>('schema');

  const tableColumns: Column<TableRow>[] = [
    {
      key: 'name',
      label: 'Table',
      sortable: true,
      render: (row) => <span className="font-mono text-text-primary">{row.name}</span>,
    },
    {
      key: 'rows',
      label: 'Rows',
      align: 'right',
      sortable: true,
      render: (row) => fmtNumber(row.rows),
    },
  ];

  return (
    <DataTable<TableRow>
      data={tables}
      columns={tableColumns}
      keyField="name"
      expandedKey={expandedKey}
      onExpandToggle={setExpandedKey}
      renderExpanded={(row) => (
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            {(['schema', 'contents'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={clsx(
                  'px-2 py-0.5 rounded text-xs border transition-colors',
                  viewMode === mode
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-border-primary bg-bg-tertiary text-text-muted hover:text-text-primary',
                )}
              >
                {mode === 'schema' ? 'Schema' : 'Contents'}
              </button>
            ))}
          </div>
          {viewMode === 'schema' ? (
            <SchemaView db={dbName} table={row.name} />
          ) : (
            <ContentsView db={dbName} table={row.name} />
          )}
        </div>
      )}
    />
  );
}

export function DbStatsPage() {
  const { data, isLoading, error, refetch } = useObsDbStats();

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load database stats" retry={refetch} />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">Database</h1>

      {data.databases.map((db) => {
        const totalRows = db.tables.reduce((sum, t) => sum + t.rows, 0);
        return (
          <div key={db.name} className="space-y-4">
            <h2 className="text-sm font-medium text-text-secondary">{db.name}</h2>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="File Size" value={fmtBytes(db.sizeBytes)} />
              <StatCard label="WAL Size" value={fmtBytes(db.walSizeBytes)} accent={db.walSizeBytes > 10 * 1024 * 1024 ? 'warning' : 'default'} />
              <StatCard label="Tables" value={db.tables.length} />
              <StatCard label="Total Rows" value={fmtNumber(totalRows)} />
            </div>

            <DbTableList dbName={db.name} tables={db.tables} />
          </div>
        );
      })}

      {data.databases.length === 0 && (
        <p className="text-sm text-text-muted italic">No databases found.</p>
      )}
    </div>
  );
}
