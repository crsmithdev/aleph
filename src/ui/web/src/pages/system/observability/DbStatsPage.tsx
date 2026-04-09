import { useState } from 'react';
import { useObsDbStats, useObsDbSchema, useObsDbContents } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { PageHeader } from '../../../components/layout/PageHeader';
import { fmtNumber, fmtBytes } from '../../../utils/format';
import { clsx } from 'clsx';
type TableRow = { name: string; rows: number };

function SchemaView({ db, table }: { db: string; table: string }) {
  const { data, isLoading, error } = useObsDbSchema(db, table);

  if (isLoading) return <span className="text-sm text-text-muted font-mono">Loading schema...</span>;
  if (error || !data || data.columns.length === 0) return <span className="text-sm text-text-muted">No schema available</span>;

  return (
    <table className="w-full text-sm">
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

  if (isLoading) return <span className="text-sm text-text-muted font-mono">Loading...</span>;
  if (error || !data) return <span className="text-sm text-error">Failed to load contents</span>;
  if (data.rows.length === 0) return <span className="text-sm text-text-muted italic">No rows</span>;

  const columns = Object.keys(data.rows[0]);
  const totalPages = Math.ceil(data.total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
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
                  let display: React.ReactNode;
                  let isNull = false;
                  if (val === null || val === undefined) {
                    isNull = true;
                    display = '—';
                  } else if (typeof val === 'object') {
                    const s = JSON.stringify(val);
                    display = s.length > 120 ? s.slice(0, 120) + '…' : s;
                  } else if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
                    try {
                      const parsed = JSON.parse(val);
                      const s = JSON.stringify(parsed);
                      display = s.length > 120 ? s.slice(0, 120) + '…' : s;
                    } catch {
                      display = val.length > 120 ? val.slice(0, 120) + '…' : val;
                    }
                  } else {
                    const s = String(val);
                    display = s.length > 120 ? s.slice(0, 120) + '…' : s;
                  }
                  return (
                    <td key={col} className={clsx('py-1 pr-4 font-mono max-w-xs truncate', isNull ? 'text-text-muted' : 'text-text-secondary')} title={val != null && typeof val === 'object' ? JSON.stringify(val) : String(val ?? '')}>
                      {display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.total > limit && (
        <div className="flex items-center gap-3 text-sm text-text-muted">
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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'schema' | 'contents'>('schema');

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {tables.map((t) => (
          <button
            key={t.name}
            onClick={() => { setExpanded(expanded === t.name ? null : t.name); setViewMode('schema'); }}
            className={clsx(
              'flex items-center justify-between px-3 py-1.5 rounded border text-sm font-mono transition-colors text-left',
              expanded === t.name
                ? 'border-accent/40 bg-accent/5 text-accent'
                : 'border-border-primary bg-bg-tertiary/40 text-text-primary hover:border-border-secondary',
            )}
          >
            <span className="truncate">{t.name}</span>
            <span className="text-text-muted ml-2 shrink-0">{fmtNumber(t.rows)}</span>
          </button>
        ))}
      </div>
      {expanded && (
        <div className="space-y-2 border border-border-primary rounded p-3">
          <div className="flex items-center gap-1">
            {(['schema', 'contents'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={clsx(
                  'px-2 py-0.5 rounded text-sm border transition-colors',
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
            <SchemaView db={dbName} table={expanded} />
          ) : (
            <ContentsView db={dbName} table={expanded} />
          )}
        </div>
      )}
    </div>
  );
}

export function DbStatsPage() {
  const { data, isLoading, error, refetch } = useObsDbStats();

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load database stats" retry={refetch} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Database" />

      {data.databases.map((db) => {
        const totalRows = db.tables.reduce((sum, t) => sum + t.rows, 0);
        return (
          <div key={db.name} className="space-y-6">
            <div>
              <div className="flex items-baseline gap-4">
                <h2 className="text-xl font-medium text-text-secondary">{db.name}</h2>
                <span className="text-sm font-mono flex items-center gap-1.5">
                  <span className="text-accent">{fmtBytes(db.sizeBytes)}</span>
                  {db.walSizeBytes > 0 && <><span className="text-text-muted/30">|</span><span className={db.walSizeBytes > 10 * 1024 * 1024 ? 'text-warning' : 'text-text-secondary'}>WAL {fmtBytes(db.walSizeBytes)}</span></>}
                  <span className="text-text-muted/30">|</span>
                  <span className="text-text-secondary">{db.tables.length} tables</span>
                  <span className="text-text-muted/30">|</span>
                  <span className="text-text-secondary">{fmtNumber(totalRows)} rows</span>
                </span>
              </div>
              <div className="text-xs font-mono text-text-muted mt-0.5">{db.path}</div>
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
