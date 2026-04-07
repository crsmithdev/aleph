import { useState } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { useMonitors, useCreateMonitor } from '../../api/monitor-hooks';
import { Button } from '../../components/ui/Button';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageHeader } from '../../components/layout/PageHeader';

const statusColors: Record<string, string> = {
  active: 'bg-green-900/50 text-green-300',
  paused: 'bg-yellow-900/50 text-yellow-300',
  archived: 'bg-bg-tertiary text-text-muted',
};

export function MonitorsPage() {
  const { data: monitors = [], isLoading, isError } = useMonitors();
  const createMonitor = useCreateMonitor();
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    createMonitor.mutate(
      { title: title.trim() || query.trim(), queries: [query.trim()] },
      { onSuccess: () => { setTitle(''); setQuery(''); setNewOpen(false); } }
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Monitors"
        subtitle={`${monitors.length} monitor${monitors.length !== 1 ? 's' : ''}`}
        actions={<Button onClick={() => setNewOpen(!newOpen)}>+ New monitor</Button>}
      />

      {newOpen && (
        <form onSubmit={handleCreate} className="bg-bg-secondary border border-border-primary rounded-lg p-4 space-y-3">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Monitor title (optional)"
            className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
          <div className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search query to monitor..."
              className="flex-1 bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              autoFocus
            />
            <Button type="submit" loading={createMonitor.isPending}>Create</Button>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <PageLoading />
      ) : isError ? (
        <ErrorState message="Failed to load monitors." />
      ) : monitors.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          No monitors yet. Create one to track changes over time.
        </div>
      ) : (
        <div className="space-y-2">
          {monitors.map(monitor => (
            <Link
              key={monitor.id}
              to={`/research/monitors/${monitor.id}`}
              className="block bg-bg-secondary border border-border-primary rounded-lg p-4 hover:border-border-secondary transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-text-primary truncate">{monitor.title}</h3>
                  <p className="text-xs text-text-muted mt-1">{monitor.queries.join(', ')}</p>
                  <p className="text-xs text-text-muted mt-1">Schedule: {monitor.schedule}</p>
                </div>
                <span className={clsx('px-2 py-0.5 rounded text-xs font-medium ml-3', statusColors[monitor.status])}>
                  {monitor.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
