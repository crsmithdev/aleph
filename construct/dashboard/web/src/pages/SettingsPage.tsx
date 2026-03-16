import { useState } from 'react';
import { useWebhooks, useCreateWebhook, useDeleteWebhook } from '../api/hooks';
import { api } from '../api/client';

// --- Types ---

type ApiToken = {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
};

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
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-base font-semibold text-gray-200">{title}</h2>
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
      const data = await api.get<Backup[]>('/backups');
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
      await api.post('/backups');
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
      await api.post(`/backups/${encodeURIComponent(filename)}/restore`);
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
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
        >
          {creating ? 'Creating...' : 'Create Backup'}
        </button>
        <button
          onClick={loadBackups}
          disabled={loading}
          className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors border border-gray-700"
        >
          {loading ? 'Loading...' : 'Load Backups'}
        </button>
        {message && <span className="text-xs text-gray-400">{message}</span>}
      </div>

      {backups.length > 0 && (
        <div className="space-y-2 mt-2">
          {backups.map((b) => (
            <div
              key={b.filename}
              className="flex items-center justify-between p-2 bg-gray-800 rounded-lg"
            >
              <div>
                <div className="text-sm text-gray-200">{b.filename}</div>
                <div className="text-xs text-gray-500">
                  {new Date(b.createdAt).toLocaleString()}
                  {b.size !== undefined && ` · ${(b.size / 1024).toFixed(1)} KB`}
                </div>
              </div>
              <button
                onClick={() => restoreBackup(b.filename)}
                className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded hover:bg-gray-700 transition-colors"
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
      {isLoading && <div className="text-sm text-gray-500 italic">Loading...</div>}

      {webhooks && webhooks.length > 0 && (
        <div className="space-y-2">
          {webhooks.map((wh) => (
            <div
              key={wh.id}
              className="flex items-start justify-between p-3 bg-gray-800 rounded-lg gap-3"
            >
              <div className="min-w-0">
                <div className="text-sm text-gray-200 truncate">{wh.url}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {wh.events.map((e) => (
                    <span
                      key={e}
                      className="text-xs px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded"
                    >
                      {e}
                    </span>
                  ))}
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  {wh.active ? (
                    <span className="text-green-500">active</span>
                  ) : (
                    <span className="text-gray-500">inactive</span>
                  )}
                  {' · '}
                  {new Date(wh.createdAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => deleteWebhook.mutate(wh.id)}
                className="text-gray-500 hover:text-red-400 text-lg flex-shrink-0"
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
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          + Add Webhook
        </button>
      ) : (
        <div className="space-y-3 border border-gray-700 rounded-lg p-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/webhook"
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Events</label>
            <div className="flex flex-wrap gap-2">
              {ALL_EVENTS.map((event) => (
                <label key={event} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(event)}
                    onChange={() => toggleEvent(event)}
                    className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-blue-600"
                  />
                  <span className="text-xs text-gray-400">{event}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Secret (optional)</label>
            <input
              type="text"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Webhook secret for HMAC signing"
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!url.trim() || selectedEvents.length === 0 || createWebhook.isPending}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
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
              className="px-3 py-1.5 text-gray-400 hover:text-gray-200 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

// --- API Tokens Section ---

function ApiTokensSection() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');

  const loadTokens = async () => {
    setLoading(true);
    try {
      const data = await api.get<ApiToken[]>('/tokens');
      setTokens(data);
    } catch {
      setMessage('Failed to load tokens.');
    } finally {
      setLoading(false);
    }
  };

  const createToken = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setMessage('');
    try {
      const result = await api.post<{ token: string } & ApiToken>('/tokens', { name: newName.trim() });
      setNewToken(result.token);
      setTokens((prev) => [...prev, result]);
      setNewName('');
      setShowForm(false);
    } catch {
      setMessage('Failed to create token.');
    } finally {
      setCreating(false);
    }
  };

  const revokeToken = async (id: string) => {
    try {
      await api.delete(`/tokens/${id}`);
      setTokens((prev) => prev.filter((t) => t.id !== id));
    } catch {
      setMessage('Failed to revoke token.');
    }
  };

  return (
    <Section title="API Tokens">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={loadTokens}
          disabled={loading}
          className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors border border-gray-700"
        >
          {loading ? 'Loading...' : 'Load Tokens'}
        </button>
        {message && <span className="text-xs text-gray-400">{message}</span>}
      </div>

      {newToken && (
        <div className="bg-green-950 border border-green-800 rounded-lg p-3 space-y-1">
          <div className="text-xs text-green-400 font-semibold">
            Token created — copy it now, it won't be shown again:
          </div>
          <div className="font-mono text-sm text-green-300 break-all select-all">{newToken}</div>
          <button
            onClick={() => setNewToken(null)}
            className="text-xs text-green-600 hover:text-green-400"
          >
            Dismiss
          </button>
        </div>
      )}

      {tokens.length > 0 && (
        <div className="space-y-2">
          {tokens.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between p-2 bg-gray-800 rounded-lg gap-3"
            >
              <div>
                <div className="text-sm text-gray-200">{t.name}</div>
                <div className="text-xs text-gray-500">
                  Created {new Date(t.createdAt).toLocaleDateString()}
                  {t.lastUsedAt
                    ? ` · Last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                    : ' · Never used'}
                </div>
              </div>
              <button
                onClick={() => revokeToken(t.id)}
                className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-gray-700 transition-colors flex-shrink-0"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          + Create Token
        </button>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createToken()}
            placeholder="Token name"
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
          />
          <button
            onClick={createToken}
            disabled={!newName.trim() || creating}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
          <button
            onClick={() => {
              setShowForm(false);
              setNewName('');
            }}
            className="text-sm text-gray-400 hover:text-gray-200"
          >
            Cancel
          </button>
        </div>
      )}
    </Section>
  );
}

// --- Account Section ---

function AccountSection() {
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await api.post('/auth/logout');
      window.location.href = '/login';
    } catch {
      setLoggingOut(false);
    }
  };

  return (
    <Section title="Account">
      <button
        onClick={handleLogout}
        disabled={loggingOut}
        className="px-4 py-2 bg-red-900 hover:bg-red-800 disabled:opacity-50 text-red-200 text-sm rounded-lg transition-colors border border-red-800"
      >
        {loggingOut ? 'Logging out...' : 'Logout'}
      </button>
    </Section>
  );
}

// --- Main Settings Page ---

export function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6 py-6 px-4">
      <h1 className="text-2xl font-bold text-gray-100">Settings</h1>

      <BackupSection />
      <WebhooksSection />
      <ApiTokensSection />
      <AccountSection />
    </div>
  );
}
