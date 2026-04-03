import { useParams, Link } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  useMonitor, useMonitorSnapshots, useMonitorAlerts, useUpdateMonitor,
  type MonitorAlert,
} from '../../api/monitor-hooks';
import { Button } from '../../components/ui/Button';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { useState } from 'react';

const severityColors: Record<string, string> = {
  urgent: 'bg-red-900/50 text-red-300',
  notable: 'bg-yellow-900/50 text-yellow-300',
  info: 'bg-bg-tertiary text-text-muted',
};

const alertTypeIcons: Record<string, string> = {
  new_item: '+',
  removed_item: '-',
  changed_item: '~',
  threshold_crossed: '!',
  custom: '*',
};

function AlertCard({ alert }: { alert: MonitorAlert }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-bg-secondary border border-border-primary rounded-lg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <span className="text-sm font-mono text-text-muted w-4 text-center">
            {alertTypeIcons[alert.alert_type] ?? '?'}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text-primary truncate">{alert.title}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={clsx('px-1.5 py-0.5 rounded text-xs font-medium', severityColors[alert.severity])}>
                {alert.severity}
              </span>
              <span className="text-xs text-text-muted">{new Date(alert.created_at).toLocaleString()}</span>
            </div>
          </div>
        </div>
        <button onClick={() => setExpanded(!expanded)} className="text-xs text-accent hover:underline shrink-0">
          {expanded ? 'Less' : 'More'}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 pl-6">
          <p className="text-sm text-text-secondary whitespace-pre-wrap">{alert.content}</p>
          {alert.source_url && (
            <a href={alert.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline mt-1 block">
              {alert.source_url}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function MonitorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: monitor, isLoading, isError } = useMonitor(id!);
  const { data: snapshots = [] } = useMonitorSnapshots(id!);
  const { data: alerts = [] } = useMonitorAlerts(id!);
  const updateMonitor = useUpdateMonitor();

  if (isLoading) return <PageLoading />;
  if (isError || !monitor) return <ErrorState message="Monitor not found." />;

  const totalCost = snapshots.reduce((sum, s) => sum + s.cost_usd, 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link to="/research/monitors" className="text-xs text-accent hover:underline">&larr; All monitors</Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">{monitor.title}</h1>
            <p className="text-sm text-text-muted mt-0.5">{monitor.queries.join(', ')}</p>
          </div>
          <div className="flex items-center gap-2">
            {monitor.status === 'active' && (
              <Button variant="secondary" size="sm" onClick={() => updateMonitor.mutate({ id: id!, status: 'paused' })}>
                Pause
              </Button>
            )}
            {monitor.status === 'paused' && (
              <Button variant="secondary" size="sm" onClick={() => updateMonitor.mutate({ id: id!, status: 'active' })}>
                Resume
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Snapshots', value: snapshots.length },
          { label: 'Alerts', value: alerts.length },
          { label: 'Urgent', value: alerts.filter(a => a.severity === 'urgent').length },
          { label: 'Total Cost', value: `$${totalCost.toFixed(3)}` },
        ].map(stat => (
          <div key={stat.label} className="bg-bg-secondary border border-border-primary rounded-lg p-3">
            <p className="text-xs text-text-muted">{stat.label}</p>
            <p className="text-lg font-semibold text-text-primary">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Config */}
      <div className="bg-bg-secondary border border-border-primary rounded-lg p-4">
        <h3 className="text-xs font-medium text-text-muted mb-2">Configuration</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-text-muted">Schedule:</span>
            <span className="ml-1 text-text-primary">{monitor.schedule}</span>
          </div>
          <div>
            <span className="text-text-muted">Model:</span>
            <span className="ml-1 text-text-primary">{monitor.model}</span>
          </div>
          <div>
            <span className="text-text-muted">Status:</span>
            <span className={clsx('ml-1 px-1.5 py-0.5 rounded text-xs font-medium',
              monitor.status === 'active' ? 'bg-green-900/50 text-green-300' : 'bg-yellow-900/50 text-yellow-300'
            )}>
              {monitor.status}
            </span>
          </div>
        </div>
      </div>

      {/* Alerts */}
      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-3">
          Alerts ({alerts.length})
        </h2>
        {alerts.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-8">No alerts yet.</p>
        ) : (
          <div className="space-y-2">
            {alerts.map(alert => <AlertCard key={alert.id} alert={alert} />)}
          </div>
        )}
      </div>

      {/* Snapshots */}
      {snapshots.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary mb-3">
            Snapshots ({snapshots.length})
          </h2>
          <div className="space-y-1">
            {snapshots.slice(0, 20).map(snap => (
              <div key={snap.id} className="bg-bg-secondary border border-border-primary rounded px-3 py-2 flex items-center justify-between text-sm">
                <span className="text-text-primary">Cycle {snap.cycle_number}</span>
                <div className="flex items-center gap-4 text-xs text-text-muted">
                  <span>{snap.item_count} items</span>
                  <span>${snap.cost_usd.toFixed(4)}</span>
                  <span>{new Date(snap.created_at).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
