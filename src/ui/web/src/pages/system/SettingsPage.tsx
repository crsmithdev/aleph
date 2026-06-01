import { Icon } from '../../components/ui/Icon';
import React, { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { fmtBytes, dateTime } from '../../utils/format';
import { PageHeader } from '../../components/layout/PageHeader';
import { clsx } from 'clsx';
import { useTheme } from '../../theme';
import { darkThemes, lightThemes, type ThemeDef } from '../../themes';

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
    aleph: string;
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
  dataFiles: { label: string; path: string; sizeBytes: number }[];
};

// --- Section wrapper ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-secondary border border-border-primary rounded-lg">
      <div className="px-4 py-3 border-b border-border-primary">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
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
    <Section title="System">
      <InfoGrid rows={[
        ['Revision', `${buildTag} (${info.git.branch})`],
        ['Last Change', info.git.lastCommitDate],
        ['Installed', formatTimestamp(info.install.timestamp)],
        ['API Port', String(info.runtime.port)],
      ]} />
      <hr className="border-border-primary" />
      <div className="grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1.5 items-baseline">
        {info.dataFiles.map((f) => (
          <React.Fragment key={f.path}>
            <span className="text-xs whitespace-nowrap text-text-muted">{f.label}</span>
            <span className="font-mono text-xs truncate text-text-primary" title={f.path}>{f.path}</span>
            <span className="font-mono text-xs whitespace-nowrap text-text-muted tabular-nums text-right">{fmtBytes(f.sizeBytes)}</span>
          </React.Fragment>
        ))}
      </div>
    </Section>
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
            'inline-flex items-center h-8 px-3 bg-accent hover:bg-accent-hover disabled:opacity-50',
            'text-white text-sm rounded-lg transition-colors'
          )}
        >
          {creating ? 'Creating...' : 'Create Backup'}
        </button>
        <button
          onClick={loadBackups}
          disabled={loading}
          className={clsx(
            'inline-flex items-center justify-center h-8 w-8 bg-bg-tertiary hover:bg-bg-hover disabled:opacity-50',
            'text-text-secondary rounded-lg transition-colors border border-border-primary'
          )}
          title="Refresh backups"
        >
          <Icon name="refresh" size="sm" />
        </button>
        {message && <span className="text-sm text-text-muted">{message}</span>}
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
                  {dateTime(b.createdAt)}
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

// --- Theme Section ---

function ThemeSwatch({ vars, size = 'md' }: { vars: Record<string, string>; size?: 'md' | 'lg' }) {
  const stops = [
    vars['--bg-primary'],
    vars['--accent'],
    vars['--chart-2'],
    vars['--chart-3'],
    vars['--chart-5'],
  ];
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 rounded-md border border-border-primary overflow-hidden',
        size === 'lg' ? 'h-7 w-20' : 'h-5 w-14'
      )}
      aria-hidden
    >
      {stops.map((c, i) => (
        <span key={i} className="h-full" style={{ flex: 1, background: c }} />
      ))}
    </span>
  );
}

function ThemeOption({ t, active, onSelect }: { t: ThemeDef; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={clsx(
        'flex items-center gap-3 w-full px-3 py-2 text-sm transition-colors',
        active ? 'text-accent bg-bg-tertiary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
      )}
    >
      <ThemeSwatch vars={t.vars} size="lg" />
      <span className="flex-1 text-left truncate">{t.name}</span>
      {active && <Icon name="check" size="sm" />}
    </button>
  );
}

function ThemeSection() {
  const { themeId, theme, setThemeId } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <Section title="Theme">
      <div className="relative w-full max-w-sm">
        <button
          onClick={() => setOpen(!open)}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          className={clsx(
            'flex items-center justify-between w-full rounded-lg border border-border-primary',
            'bg-bg-tertiary px-3 py-2 text-sm text-text-primary hover:bg-bg-hover transition-colors'
          )}
        >
          <span className="flex items-center gap-3 min-w-0">
            <ThemeSwatch vars={theme.vars} size="lg" />
            <span className="truncate">{theme.name}</span>
            <span className="text-xs text-text-muted shrink-0">{theme.mode === 'dark' ? 'Dark' : 'Light'}</span>
          </span>
          <Icon name="expand_more" size="sm" className="text-text-muted shrink-0" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} role="presentation" />
            <div className="absolute top-full left-0 mt-1 w-full max-h-96 overflow-y-auto z-50 rounded-lg border border-border-primary bg-bg-secondary shadow-md py-1">
              <div className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Dark</div>
              {darkThemes.map((t) => (
                <ThemeOption key={t.id} t={t} active={t.id === themeId} onSelect={() => { setThemeId(t.id); setOpen(false); }} />
              ))}
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted border-t border-border-primary mt-1">Light</div>
              {lightThemes.map((t) => (
                <ThemeOption key={t.id} t={t} active={t.id === themeId} onSelect={() => { setThemeId(t.id); setOpen(false); }} />
              ))}
            </div>
          </>
        )}
      </div>
    </Section>
  );
}

// --- Main Settings Page ---

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      <ThemeSection />
      <SystemInfoSection />
      <BackupSection />
    </div>
  );
}
