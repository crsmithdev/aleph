import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useObsHooks } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { TimeRangeSelector } from '../../../components/data/TimeRangeSelector';
import { fmtNumber, fmtMs } from '../../../utils/format';
import { cn } from '../../../utils/cn';

type HookRow = {
  command: string;
  event: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  errors: number;
};

export function HooksPage() {
  const [days, setDays] = useState(30);
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useObsHooks(days);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load hooks" retry={refetch} />;

  const columns: Column<HookRow>[] = [
    {
      key: 'command',
      label: 'Hook',
      render: (row) => <span className="font-mono text-text-primary">{row.command}</span>,
    },
    {
      key: 'event',
      label: 'Event',
      render: (row) => <span className="text-text-secondary">{row.event}</span>,
    },
    {
      key: 'count',
      label: 'Count',
      align: 'right',
      sortable: true,
      render: (row) => fmtNumber(row.count),
    },
    {
      key: 'avgMs',
      label: 'Avg',
      align: 'right',
      sortable: true,
      render: (row) => fmtMs(row.avgMs),
    },
    {
      key: 'p50Ms',
      label: 'P50',
      align: 'right',
      sortable: true,
      render: (row) => fmtMs(row.p50Ms),
    },
    {
      key: 'p95Ms',
      label: 'P95',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className={cn(row.p95Ms > 500 && 'text-warning')}>
          {fmtMs(row.p95Ms)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">Hooks</h1>
        <TimeRangeSelector value={days} onChange={setDays} />
      </div>

      <DataTable<HookRow>
        data={data.ranked}
        columns={columns}
        keyField="command"
        onRowClick={(row) =>
          navigate(`/system/observability/hooks/${encodeURIComponent(row.command)}`)
        }
      />
    </div>
  );
}
