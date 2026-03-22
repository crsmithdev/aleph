import { useState } from 'react';
import { useWebhooks, useCreateWebhook, useDeleteWebhook } from '../../api/hooks';
import { api } from '../../api/client';
import { cn } from '../../utils/cn';

// --- Types ---

type Backup = {
  filename: string;
  createdAt: string;
  size?: number;
};

const ALL_EVENTS = [
  'goal.created',
  'goal.updated',
  'goal.deleted',
  'todo.created',
  'todo.completed',
  'note.created',
];

// --- Section wrapper ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-secondary border border-border-primary rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border-primary">
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

// --- Backup Section ---

function BackupSection() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');

  const loadBackups = async () => {
    setLoading(true);
    try {
      const data = await api.get<Backup[]>('/backup/list');
      setBackups(data);
    } catch {
      setMessage('Failed to load backups.');
    } finally {
      setLoading(false);
    }
  };

  const createBackup = async () => {
    setCreating(true);
    setMessage('');
    try {
      await api.post('/backup/create');
      setMessage('Backup created.');
      loadBackups();
    } catch {
      setMessage('Failed to create backup.');
    } finally {
      setCreating(false);
    }
  };

  const restoreBackup = async (filename: string) => {
    if (!confirm(`Restore backup "${filename}"? This will overwrite current data.`)) return;
    try {
      await api.post('/backup/restore', { filename });
      setMessage('Backup restored. Refresh the page.');
    } catch {
      setMessage('Failed to restore backup.');
    }
  };

  return (
    <Section title="Backup">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={createBackup}
          disabled={creating}
          className={cn(
            'px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50',
            'text-white text-sm rounded-lg transition-colors'
          )}
        >
          {creating ? 'Creating...' : 'Create Backup'}
        </button>
        <button
          onClick={loadBackups}
          disabled={loading}
          className={cn(
            'px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover',
            'text-text-secondary text-sm rounded-lg transition-colors border border-border-primary'
          )}
        >
          {loading ? 'Loading...' : 'Load Backups'}
        </button>
        {message && <span className="text-xs text-text-muted">{message}</span>}
      </div>

      {backups.length > 0 && (
        <div className="space-y-2 mt-2">
          {backups.map((b) => (
            <div
              key={b.filename}
              className="flex items-center justify-between p-2 bg-bg-tertiary rounded-lg"
            >
              <div>
                <div className="text-sm text-text-primary">{b.filename}</div>
                <div className="text-xs text-text-muted">
                  {new Date(b.createdAt).toLocaleString()}
                  {b.size !== undefined && ` · ${(b.size / 1024).toFixed(1)} KB`}
                </div>
              </div>
              <button
                onClick={() => restoreBackup(b.filename)}
                className="text-xs text-accent hover:text-accent-muted px-2 py-1 rounded hover:bg-bg-hover transition-colors"
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// --- Webhooks Section ---

function WebhooksSection() {
  const { data: webhooks, isLoading } = useWebhooks();
  const createWebhook = useCreateWebhook();
  const deleteWebhook = useDeleteWebhook();

  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [secret, setSecret] = useState('');

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const handleCreate = () => {
    if (!url.trim() || selectedEvents.length === 0) return;
    createWebhook.mutate(
      { url: url.trim(), events: selectedEvents },
      {
        onSuccess: () => {
          setUrl('');
          setSelectedEvents([]);
          setSecret('');
          setShowForm(false);
        },
      }
    );
  };

  return (
    <Section title="Webhooks">
      {isLoading && <div className="text-sm text-text-muted italic">Loading...</div>}

      {webhooks && webhooks.length > 0 && (
        <div className="space-y-2">
          {webhooks.map((wh) => (
            <div
              key={wh.id}
              className="flex items-start justify-between p-3 bg-bg-tertiary rounded-lg gap-3"
            >
              <div className="min-w-0">
                <div className="text-sm text-text-primary truncate">{wh.url}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {wh.events.map((e) => (
                    <span
                      key={e}
                      className="text-xs px-1.5 py-0.5 bg-bg-hover text-text-muted rounded"
                    >
                      {e}
                    </span>
                  ))}
                </div>
                <div className="text-xs text-text-muted mt-1">
                  {wh.active ? (
                    <span className="text-success">active</span>
                  ) : (
                    <span className="text-text-muted">inactive</span>
                  )}
                  {' · '}
                  {new Date(wh.createdAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => deleteWebhook.mutate(wh.id)}
                className="text-text-muted hover:text-error text-lg flex-shrink-0"
                title="Delete webhook"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="text-sm text-accent hover:text-accent-muted"
        >
          + Add Webhook
        </button>
      ) : (
        <div className="space-y-3 border border-border-secondary rounded-lg p-3">
          <div>
            <label className="text-xs text-text-muted block mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/webhook"
              className={cn(
                'w-full bg-bg-tertiary border border-border-primary rounded',
                'px-2 py-1.5 text-sm text-text-primary placeholder-text-muted',
                'focus:outline-none focus:border-accent'
              )}
            />
          </div>

          <div>
            <label className="text-xs text-text-muted block mb-1">Events</label>
            <div className="flex flex-wrap gap-2">
              {ALL_EVENTS.map((event) => (
                <label key={event} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(event)}
                    onChange={() => toggleEvent(event)}
                    className="h-3.5 w-3.5 rounded border-border-primary bg-bg-tertiary text-accent"
                  />
                  <span className="text-xs text-text-muted">{event}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-text-muted block mb-1">Secret (optional)</label>
            <input
              type="text"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Webhook secret for HMAC signing"
              className={cn(
                'w-full bg-bg-tertiary border border-border-primary rounded',
                'px-2 py-1.5 text-sm text-text-primary placeholder-text-muted',
                'focus:outline-none focus:border-accent'
              )}
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!url.trim() || selectedEvents.length === 0 || createWebhook.isPending}
              className={cn(
                'px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50',
                'text-white text-sm rounded-lg transition-colors'
              )}
            >
              {createWebhook.isPending ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setUrl('');
                setSelectedEvents([]);
                setSecret('');
              }}
              className="px-3 py-1.5 text-text-muted hover:text-text-primary text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

// --- Main Settings Page ---

export function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6 py-6 px-4">
      <h1 className="text-2xl font-bold text-text-primary">Settings</h1>

      <BackupSection />
      <WebhooksSection />
    </div>
  );
}
