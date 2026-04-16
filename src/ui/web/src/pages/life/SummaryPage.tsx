import { useState } from 'react';
import { useSummary, useHabits } from '../../api/hooks';
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

interface PeriodSummaryProps {
  start: string;
  end: string;
  heading: string;
  data: PeriodSummaryData | undefined;
  isLoading: boolean;
  completedHabits: string[];
}

function PeriodSummary({ start, end, heading, data, isLoading, completedHabits }: PeriodSummaryProps) {
  const [copied, setCopied] = useState(false);

  const completedGoals = data?.goalsCompleted?.items ?? [];
  const completedTodos = data?.todosCompleted?.items ?? [];

  const hasAnything = completedGoals.length > 0 || completedTodos.length > 0 || completedHabits.length > 0;

  const dateLabel = start === end ? start : `${start} to ${end}`;

  const text = hasAnything
    ? [
        `${heading} — ${dateLabel}`,
        '',
        ...(completedGoals.length > 0
          ? ['Goals completed:', ...completedGoals.map((g) => `  - ${g.details?.title ?? g.goalId}`), '']
          : []),
        ...(completedTodos.length > 0
          ? ['Todos completed:', ...completedTodos.map((t) => `  - ${t.title}`), '']
          : []),
        ...(completedHabits.length > 0
          ? ['Habits followed today:', ...completedHabits.map((h) => `  - ${h}`)]
          : []),
      ].join('\n')
    : `Nothing completed — ${dateLabel}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="bg-bg-secondary border border-border-primary rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">{heading}</h2>
        <button
          onClick={handleCopy}
          disabled={isLoading}
          className={clsx(
            'px-3 py-1 text-xs rounded-md border transition-colors',
            copied
              ? 'bg-success/10 border-success text-success'
              : 'bg-bg-tertiary border-border-primary text-text-secondary hover:text-text-primary hover:border-border-secondary'
          )}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      {isLoading ? (
        <div className="text-xs text-text-muted">Loading...</div>
      ) : (
        <pre className="text-sm text-text-secondary whitespace-pre-wrap font-mono leading-relaxed">{text}</pre>
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
                  ? 'bg-accent border-accent text-white'
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

      <PeriodSummary start={start} end={end} heading={heading} data={data as PeriodSummaryData | undefined} isLoading={isLoading} completedHabits={completedHabits} />
    </div>
  );
}
