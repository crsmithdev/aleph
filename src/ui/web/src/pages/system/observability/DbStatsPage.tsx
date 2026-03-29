import { useState } from 'react';
import { useObsDbStats, useObsDbSchema } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { fmtNumber } from '../../../utils/format';
import { cn } from '../../../utils/cn';

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
            <td className={cn('py-1 pr-4 font-mono', 'text-text-secondary')}>{col.type || 'any'}</td>
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

function DbTableList({ dbName, tables }: { dbName: string; tables: TableRow[] }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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
      renderExpanded={(row) => <SchemaView db={dbName} table={row.name} />}
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
