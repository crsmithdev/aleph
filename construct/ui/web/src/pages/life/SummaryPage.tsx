import { useState } from 'react';
import { useSummary } from '../../api/hooks';
import { StatCard } from '../../components/data/StatCard';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { cn } from '../../utils/cn';
import { toDateStr } from '../../utils/format';

type Preset = 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'this-quarter' | 'this-year' | 'custom';

function getPresetRange(preset: Exclude<Preset, 'custom'>): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDay();

  switch (preset) {
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
    case 'this-month': {
      return {
        start: toDateStr(new Date(year, month, 1)),
        end: toDateStr(new Date(year, month + 1, 0)),
      };
    }
    case 'last-month': {
      return {
        start: toDateStr(new Date(year, month - 1, 1)),
        end: toDateStr(new Date(year, month, 0)),
      };
    }
    case 'this-quarter': {
      const q = Math.floor(month / 3);
      return {
        start: toDateStr(new Date(year, q * 3, 1)),
        end: toDateStr(new Date(year, q * 3 + 3, 0)),
      };
    }
    case 'this-year': {
      return {
        start: toDateStr(new Date(year, 0, 1)),
        end: toDateStr(new Date(year, 11, 31)),
      };
    }
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

function buildMarkdown(data: SummaryData, start: string, end: string): string {
  const lines: string[] = [
    `# Goal Tracker Summary`,
    `**Period:** ${start} to ${end}`,
    '',
    '## Goals',
    `- Created: ${data.goalsCreated?.count ?? 0}`,
    `- Completed: ${data.goalsCompleted?.count ?? 0}`,
    `- State changes: ${data.goalsStateChanged?.count ?? 0}`,
    '',
    '## Todos',
    `- Completed: ${data.todosCompleted?.count ?? 0}`,
    '',
    '## Notes',
    `- Added: ${data.notesAdded?.count ?? 0}`,
  ];

  return lines.join('\n');
}

const PRESETS: { label: string; value: Preset }[] = [
  { label: 'This Week', value: 'this-week' },
  { label: 'Last Week', value: 'last-week' },
  { label: 'This Month', value: 'this-month' },
  { label: 'Last Month', value: 'last-month' },
  { label: 'This Quarter', value: 'this-quarter' },
  { label: 'This Year', value: 'this-year' },
  { label: 'Custom', value: 'custom' },
];

export function SummaryPage() {
  const [preset, setPreset] = useState<Preset>('this-week');
  const defaultRange = getPresetRange('this-week');
  const [customStart, setCustomStart] = useState(defaultRange.start);
  const [customEnd, setCustomEnd] = useState(defaultRange.end);

  const { start, end } =
    preset === 'custom'
      ? { start: customStart, end: customEnd }
      : getPresetRange(preset as Exclude<Preset, 'custom'>);

  const { data: summary, isLoading, isError } = useSummary(start, end);
  const data = summary as SummaryData | undefined;

  const handleExport = () => {
    if (!data) return;
    const md = buildMarkdown(data, start, end);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `goal-summary-${start}-to-${end}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-6 px-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-text-primary">Summary</h1>
        <button
          onClick={handleExport}
          disabled={!data}
          className={cn(
            'px-4 py-2 text-sm rounded-lg transition-colors',
            'bg-accent hover:bg-accent-hover text-white',
            'disabled:opacity-40 disabled:cursor-not-allowed'
          )}
        >
          Export Markdown
        </button>
      </div>

      {/* Preset selector */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className={cn(
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

        <div className="text-xs text-text-muted">
          {start} to {end}
        </div>
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
            <StatCard label="Todos Done" value={data.todosCompleted?.count ?? 0} />
            <StatCard label="Notes Added" value={data.notesAdded?.count ?? 0} accent="warning" />
          </div>

          {(data.goalsStateChanged?.count ?? 0) > 0 && (
            <div className="bg-bg-secondary border border-border-primary rounded-lg p-4 space-y-2">
              <h2 className="text-sm font-semibold text-text-secondary">State Changes ({data.goalsStateChanged!.count})</h2>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
