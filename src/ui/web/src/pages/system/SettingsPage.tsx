import React, { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { fmtBytes } from '../../utils/format';
import { clsx } from 'clsx';

// --- Types ---

type Backup = {
  filename: string;
  createdAt: string;
  size?: number;
};

type SystemInfo = {
  git: {
    revision: string;
    short: string;
    dirty: boolean;
    branch: string;
    commitCount: string;
    commitsSinceTag: string;
    lastCommit: string;
    lastCommitDate: string;
  };
  paths: {
    repo: string;
    claudeRoot: string;
    construct: string;
    commands: string;
    skills: string;
    db: string;
    memoryDb: string;
    sessions: string;
    telemetry: string;
    signals: string;
    ratings: string;
    backups: string;
  };
  install: {
    timestamp: string;
    bunVersion: string;
    platform: string;
    arch: string;
  };
  runtime: {
    nodeEnv: string;
    port: number;
    dbSizeBytes: number;
  };
};

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

const ABSENT = new Set(['unknown', 'n/a', 'dev', '-', '']);

function InfoGrid({ rows, dimAfter }: { rows: [string, string][]; dimAfter?: number }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
      {rows.map(([key, value], i) => {
        const absent = ABSENT.has(value);
        const dim = dimAfter != null && i >= dimAfter;
        return (
          <React.Fragment key={key}>
            <span className={`text-xs whitespace-nowrap ${absent || dim ? 'text-text-muted/50' : 'text-text-muted'}`}>{key}</span>
            <span className={`font-mono text-xs truncate ${absent ? 'text-text-muted/40' : dim ? 'text-text-muted/70' : 'text-text-primary'}`} title={value}>
              {absent ? '–' : value}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}
function formatTimestamp(ts: string): string {
  if (ts === 'unknown' || ts === 'dev') return ts;
  try {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toLocaleString();
  } catch { return ts; }
}

// --- System Info Section ---

function SystemInfoSection() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get<SystemInfo>('/system/info').then(setInfo).catch(() => setError(true));
  }, []);

  if (error) return <Section title="System"><span className="text-xs text-error">Failed to load system info</span></Section>;
  if (!info) return <Section title="System"><span className="text-xs text-text-muted">Loading...</span></Section>;

  const buildTag = `${info.git.short}${info.git.dirty ? '-dirty' : ''}`;

  return (
    <>
      <Section title="Build">
        <InfoGrid rows={[
          ['Revision', `${buildTag} (${info.git.branch})`],
          ['Commits', `${info.git.commitCount} total${info.git.commitsSinceTag !== 'n/a' ? `, ${info.git.commitsSinceTag}` : ''}`],
          ['Last Commit', info.git.lastCommit],
          ['Commit Date', info.git.lastCommitDate],
          ['Installed', formatTimestamp(info.install.timestamp)],
          ['Bun', info.install.bunVersion],
          ['Platform', `${info.install.platform} / ${info.install.arch}`],
          ['API Port', String(info.runtime.port)],
          ['DB Size', fmtBytes(info.runtime.dbSizeBytes)],
        ]} />
      </Section>

      <Section title="Paths">
        <InfoGrid rows={[
          ['Construct DB', info.paths.db],
          ['Memory DB', info.paths.memoryDb],
          ['Telemetry', info.paths.telemetry],
          ['Backups', info.paths.backups],
        ]} />
      </Section>
    </>
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

  useEffect(() => {
    loadBackups();
  }, []);

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
          className={clsx(
            'px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50',
            'text-white text-sm rounded-lg transition-colors'
          )}
        >
          {creating ? 'Creating...' : 'Create Backup'}
        </button>
        <button
          onClick={loadBackups}
          disabled={loading}
          className={clsx(
            'p-1.5 bg-bg-tertiary hover:bg-bg-hover disabled:opacity-50',
            'text-text-secondary rounded-lg transition-colors border border-border-primary'
          )}
          title="Refresh backups"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 19.644V14.651" />
          </svg>
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
                  {b.size !== undefined && ` · ${fmtBytes(b.size)}`}
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

// --- Main Settings Page ---

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
      <SystemInfoSection />
      <BackupSection />
    </div>
  );
}
