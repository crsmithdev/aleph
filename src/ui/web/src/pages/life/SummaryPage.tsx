import { useState } from 'react';
import { useSummary, useHabits, useGitStats } from '../../api/hooks';
import { StatCard } from '../../components/data/StatCard';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageHeader } from '../../components/layout/PageHeader';
import { clsx } from 'clsx';
import { toDateStr, longDate } from '../../utils/format';

type PeriodSummaryData = {
  goalsCompleted?: { count: number; items: Array<{ goalId: string; details: { title?: string; prevState?: string } }> };
  todosCompleted?: { count: number; items: Array<{ title: string }> };
};

interface GitStats {
  commits: number;
  added: number;
  deleted: number;
}

interface PeriodSummaryProps {
  start: string;
  end: string;
  dateDisplay: string;
  data: PeriodSummaryData | undefined;
  isLoading: boolean;
  completedHabits: string[];
  gitStats: GitStats | undefined;
}

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 pt-3 pb-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</span>
      {count !== undefined && (
        <span className="text-xs text-text-disabled">({count})</span>
      )}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5 text-sm text-text-secondary">
          <span className="text-text-disabled mt-0.5">·</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function PeriodSummary({ start, end, dateDisplay, data, isLoading, completedHabits, gitStats }: PeriodSummaryProps) {
  const [copied, setCopied] = useState(false);

  const completedGoals = data?.goalsCompleted?.items ?? [];
  const completedTodos = data?.todosCompleted?.items ?? [];

  const buildCopyText = () => {
    const lines: string[] = [`Summary — ${dateDisplay}`, ''];
    if (completedGoals.length > 0) {
      lines.push('Goals:', ...completedGoals.map((g) => `  - ${g.details?.title ?? g.goalId}`), '');
    }
    if (completedTodos.length > 0) {
      lines.push('Todos:', ...completedTodos.map((t) => `  - ${t.title}`), '');
    }
    if (completedHabits.length > 0) {
      lines.push('Habits:', ...completedHabits.map((h) => `  - ${h}`), '');
    }
    if (gitStats && gitStats.commits > 0) {
      lines.push(`Construct: +${gitStats.added} / -${gitStats.deleted} lines · ${gitStats.commits} commit${gitStats.commits !== 1 ? 's' : ''}`);
    }
    return lines.join('\n').trim();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(buildCopyText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="bg-bg-secondary border border-border-primary rounded-lg px-4 pt-3 pb-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-text-primary">Summary — {dateDisplay}</p>
        <button
          onClick={handleCopy}
          disabled={isLoading}
          className={clsx(
            'flex-shrink-0 px-3 py-1 text-xs rounded-md border transition-colors mt-0.5',
            copied
              ? 'bg-success/10 border-success text-success'
              : 'bg-bg-tertiary border-border-primary text-text-secondary hover:text-text-primary hover:border-border-secondary'
          )}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {isLoading ? (
        <div className="text-xs text-text-muted mt-4">Loading...</div>
      ) : (
        <div className="divide-y divide-border-primary/50 mt-1">
          {/* Goals */}
          {completedGoals.length > 0 && (
            <div className="pb-3">
              <SectionHeader label="Goals" count={completedGoals.length} />
              <BulletList items={completedGoals.map((g) => g.details?.title ?? g.goalId)} />
            </div>
          )}

          {/* Todos */}
          {completedTodos.length > 0 && (
            <div className="pb-3">
              <SectionHeader label="Todos" count={completedTodos.length} />
              <BulletList items={completedTodos.map((t) => t.title)} />
            </div>
          )}

          {/* Habits */}
          {completedHabits.length > 0 && (
            <div className="pb-3">
              <SectionHeader label="Habits" count={completedHabits.length} />
              <BulletList items={completedHabits} />
            </div>
          )}

          {/* Git stats */}
          {gitStats && gitStats.commits > 0 && (
            <div className="pt-3">
              <SectionHeader label="Construct" />
              <div className="flex items-baseline gap-3 text-sm pl-1 flex-wrap">
                <span className="text-success font-mono whitespace-nowrap">+{gitStats.added} / −{gitStats.deleted} lines</span>
                <span className="text-text-secondary whitespace-nowrap">{gitStats.commits} commit{gitStats.commits !== 1 ? 's' : ''}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Preset = 'today' | 'yesterday' | 'this-week' | 'last-week' | 'custom';

function getPresetRange(preset: Exclude<Preset, 'custom'>): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();

  switch (preset) {
    case 'today': {
      return { start: toDateStr(now), end: toDateStr(now) };
    }
    case 'yesterday': {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      return { start: toDateStr(yesterday), end: toDateStr(yesterday) };
    }
    case 'this-week': {
      const monday = new Date(now);
      monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      monday.setHours(0, 0, 0, 0);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { start: toDateStr(monday), end: toDateStr(sunday) };
    }
    case 'last-week': {
      const monday = new Date(now);
      monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) - 7);
      monday.setHours(0, 0, 0, 0);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { start: toDateStr(monday), end: toDateStr(sunday) };
    }
  }
}

function getPresetHeading(preset: Preset): string {
  switch (preset) {
    case 'today': return "Today's Summary";
    case 'yesterday': return "Yesterday's Summary";
    case 'this-week': return "This Week's Summary";
    case 'last-week': return "Last Week's Summary";
    case 'custom': return 'Period Summary';
  }
}

interface SummaryBucket {
  count: number;
  items: Array<Record<string, unknown>>;
}

type SummaryData = {
  range?: { start: string; end: string };
  goalsCreated?: SummaryBucket;
  goalsCompleted?: SummaryBucket;
  goalsStateChanged?: SummaryBucket;
  todosCompleted?: SummaryBucket;
  notesAdded?: SummaryBucket;
};

const PRESETS: { label: string; value: Preset }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'This Week', value: 'this-week' },
  { label: 'Last Week', value: 'last-week' },
  { label: 'Custom', value: 'custom' },
];

export function SummaryPage() {
  const [preset, setPreset] = useState<Preset>('today');
  const defaultRange = getPresetRange('today');
  const [customStart, setCustomStart] = useState(defaultRange.start);
  const [customEnd, setCustomEnd] = useState(defaultRange.end);

  const { start, end } =
    preset === 'custom'
      ? { start: customStart, end: customEnd }
      : getPresetRange(preset as Exclude<Preset, 'custom'>);

  const { data: summary, isLoading, isError } = useSummary(start, end);
  const data = summary as SummaryData | undefined;

  const { data: habits } = useHabits();
  const completedHabits = (habits ?? []).filter((h) => h.completedThisPeriod).map((h) => h.title);

  const { data: gitStats } = useGitStats(start, end);

  const dateDisplay =
    start === end
      ? longDate(start)
      : `${longDate(start)} – ${longDate(end)}`;

  const heading = getPresetHeading(preset);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Summary"
        actions={<span className="text-sm text-text-muted">{dateDisplay}</span>}
      />

      {/* Preset selector */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className={clsx(
                'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                preset === p.value
                  ? 'bg-accent/15 border-accent text-accent font-medium'
                  : 'bg-bg-secondary border-border-primary text-text-secondary hover:text-text-primary hover:border-border-secondary'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-muted">From:</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="bg-bg-secondary border border-border-primary rounded px-2 py-1 text-sm text-text-secondary focus:outline-none focus:border-accent"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-muted">To:</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-bg-secondary border border-border-primary rounded px-2 py-1 text-sm text-text-secondary focus:outline-none focus:border-accent"
              />
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {isLoading && <PageLoading />}

      {isError && <ErrorState message="Failed to load summary data." />}

      {data && (
        <div className="space-y-4">
          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Goals Created" value={data.goalsCreated?.count ?? 0} />
            <StatCard label="Goals Completed" value={data.goalsCompleted?.count ?? 0} accent="success" />
            <StatCard label="Todos Completed" value={data.todosCompleted?.count ?? 0} />
            <StatCard label="Notes Added" value={data.notesAdded?.count ?? 0} accent="warning" />
          </div>

          {(data.goalsStateChanged?.count ?? 0) > 0 && (
            <div className="bg-bg-secondary border border-border-primary rounded-lg p-4 space-y-2">
              <h2 className="text-sm font-semibold text-text-secondary">State Changes ({data.goalsStateChanged!.count})</h2>
            </div>
          )}
        </div>
      )}

      <PeriodSummary
        start={start}
        end={end}
        dateDisplay={dateDisplay}
        data={data as PeriodSummaryData | undefined}
        isLoading={isLoading}
        completedHabits={completedHabits}
        gitStats={gitStats}
      />
    </div>
  );
}
