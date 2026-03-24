import { useObsDbStats } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { fmtNumber } from '../../../utils/format';

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type TableRow = { name: string; rows: number };

const tableColumns: Column<TableRow>[] = [
  {
    key: 'name',
    label: 'Table',
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

export function DbStatsPage() {
  const { data, isLoading, error, refetch } = useObsDbStats();

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load database stats" retry={refetch} />;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Database</h1>

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

            <DataTable<TableRow>
              data={db.tables}
              columns={tableColumns}
              keyField="name"
            />
          </div>
        );
      })}

      {data.databases.length === 0 && (
        <p className="text-sm text-text-muted italic">No databases found.</p>
      )}
    </div>
  );
}
