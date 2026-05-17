import { useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useObsEvents, useObsSessions, useObsTokens } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, CHART_OTHER, chartColor, labelFormatter, xAxisDateProps } from '../../../components/charts/chartTheme';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { dateTime, fmtNumber, fmtMs, fmtToolName } from '../../../utils/format';
import { GRAN_LABEL } from '../../../utils/chart-helpers';

type EventsDataset = 'activity' | 'tokens';
const EVENTS_DATASETS: { key: EventsDataset; label: string }[] = [
  { key: 'activity', label: 'Activity' },
  { key: 'tokens', label: 'Tokens' },
];

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { clsx } from 'clsx';

const EVENT_TYPES = [
  'tool_use',
  'tool_result',
  'hook_progress',
  'stop_hook_summary',
  'hook_event',
  'hook_feedback',
  'gate',
  'gate_marker',
  'tokens',
  'turn_duration',
  'directive',
  'user_message',
  'assistant_message',
  'feedback',
  'rating',
  're_edit',
  'memory_write',
  'compaction',
  'compact_boundary',
] as const;

type EntryType = typeof EVENT_TYPES[number];

type EventRow = {
  sessionId: string;
  timestamp: string;
  project: string;
  model?: string;
  entryType: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  skillName?: string;
  isError?: boolean;
  errorMessage?: string;
  toolUseId?: string;
  resultContent?: string;
  resultChars?: number;
  hookEvent?: string;
  hookName?: string;
  hookCommand?: string;
  hook?: string;
  hookDurationMs?: number;
  hookExitCode?: number;
  hookOutput?: string;
  turnDurationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  directives?: string[];
  promptWords?: number;
  userRequest?: string;
  text?: string;
  name?: string;
  tier?: number | string;
  decision?: string;
  reason?: string;
  polarity?: string;
  target?: string;
  rating?: number;
  file?: string;
  memoryType?: string;
  memoryId?: string;
  workingFiles?: number;
  recentPrompts?: number;
  compactTrigger?: string;
  compactPreTokens?: number;
};

const TYPE_LABELS: Record<EntryType, string> = {
  tool_use: 'tool_use',
  tool_result: 'tool_result',
  hook_progress: 'hook_progress',
  stop_hook_summary: 'stop_hook',
  hook_event: 'hook_event',
  hook_feedback: 'hook_feedback',
  gate: 'gate',
  gate_marker: 'gate_marker',
  tokens: 'tokens',
  turn_duration: 'turn',
  directive: 'directive',
  user_message: 'user_msg',
  assistant_message: 'asst_msg',
  feedback: 'feedback',
  rating: 'rating',
  re_edit: 're_edit',
  memory_write: 'memory',
  compaction: 'compaction',
  compact_boundary: 'compact',
};

function TypeBadge({ type, isError }: { type: string; isError?: boolean }) {
  const classes: Record<string, string> = {
    tool_use: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    tool_result: isError
      ? 'bg-error/10 text-error border-error/20'
      : 'bg-success/10 text-success border-success/20',
    hook_progress: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    stop_hook_summary: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    hook_event: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    hook_feedback: 'bg-error/10 text-error border-error/20',
    gate: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    gate_marker: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    tokens: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    turn_duration: 'bg-bg-tertiary text-text-muted border-border-primary',
    directive: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    user_message: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
    assistant_message: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    feedback: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    rating: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    re_edit: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    memory_write: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    compaction: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
    compact_boundary: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  };

  const label = TYPE_LABELS[type as EntryType] ?? type;
  const cls = classes[type] ?? 'bg-bg-tertiary text-text-muted border-border-primary';

  return (
    <span className={clsx('inline-block px-1.5 py-0.5 text-xs font-mono rounded border whitespace-nowrap', cls)}>
      {label}
    </span>
  );
}

function getDetail(row: EventRow): string {
  switch (row.entryType) {
    case 'tool_use':
      return row.skillName ? `Skill: ${row.skillName}` : (row.toolName ? fmtToolName(row.toolName) : '');
    case 'tool_result':
      if (row.isError) return row.errorMessage?.slice(0, 60) ?? 'error';
      if (row.resultContent) {
        const oneLine = row.resultContent.replace(/\s+/g, ' ').trim();
        return oneLine.slice(0, 60);
      }
      return 'ok';
    case 'hook_progress':
      return row.hookName ?? row.hookCommand?.split('/').pop()?.slice(0, 40) ?? row.hookEvent ?? '';
    case 'stop_hook_summary':
      return row.hookName ?? row.hookCommand?.split('/').pop()?.slice(0, 40) ?? '';
    case 'hook_event':
      return row.hookName ?? row.hook ?? '';
    case 'hook_feedback':
      return row.text?.slice(0, 60) ?? row.name ?? '';
    case 'gate':
      return row.hookName ?? '';
    case 'gate_marker':
      return row.hookName ?? '';
    case 'tokens':
      return row.model ?? '';
    case 'turn_duration':
      return row.turnDurationMs != null ? fmtMs(row.turnDurationMs) : '';
    case 'directive':
      return row.directives?.join(', ') ?? '';
    case 'user_message':
      return row.userRequest?.slice(0, 60) ?? row.text?.slice(0, 60) ?? '';
    case 'assistant_message':
      return row.text?.slice(0, 60) ?? '';
    case 'feedback':
      return row.polarity ?? '';
    case 'rating':
      return row.rating != null ? String(row.rating) : '';
    case 're_edit':
      return row.file?.split('/').pop() ?? row.file ?? '';
    case 'memory_write':
      return row.memoryType ?? '';
    case 'compaction':
      return row.hookName ?? '';
    case 'compact_boundary':
      return row.compactTrigger ?? '';
    default:
      return row.name ?? '';
  }
}

type InfoPreview = string | Array<[string, string]>;

function getInfoPreview(row: EventRow): InfoPreview {
  if (row.entryType === 'tool_use' && row.toolParams) {
    return Object.entries(row.toolParams)
      .slice(0, 3)
      .map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v)] as [string, string]);
  }
  if (row.entryType === 'stop_hook_summary' && row.hookOutput) {
    return row.hookOutput.slice(0, 60) + (row.hookOutput.length > 60 ? '…' : '');
  }
  if (row.entryType === 'tokens') {
    const pairs: Array<[string, string]> = [];
    if (row.inputTokens != null) pairs.push(['in', fmtNumber(row.inputTokens)]);
    if (row.outputTokens != null) pairs.push(['out', fmtNumber(row.outputTokens)]);
    if (row.cacheReadTokens != null && row.cacheReadTokens > 0) pairs.push(['cr', fmtNumber(row.cacheReadTokens)]);
    return pairs;
  }
  if (row.entryType === 'hook_progress') {
    const pairs: Array<[string, string]> = [];
    if (row.hookEvent) pairs.push(['event', row.hookEvent]);
    if (row.hookName) pairs.push(['hook', row.hookName]);
    return pairs;
  }
  if (row.entryType === 'tool_result') {
    if (row.errorMessage) return row.errorMessage.slice(0, 60) + (row.errorMessage.length > 60 ? '…' : '');
    if (row.resultChars != null) return `${fmtNumber(row.resultChars)} chars`;
  }
  if (row.entryType === 'hook_event') return row.hookEvent ?? '';
  if (row.entryType === 'gate' || row.entryType === 'gate_marker') {
    const pairs: Array<[string, string]> = [];
    if (row.hookEvent) pairs.push(['event', row.hookEvent]);
    if (row.tier != null) pairs.push(['tier', String(row.tier)]);
    if (row.decision) pairs.push(['decision', row.decision]);
    return pairs;
  }
  if (row.entryType === 'feedback') return row.target ?? '';
  if (row.entryType === 're_edit') return row.file ?? '';
  if (row.entryType === 'memory_write') return row.memoryId ?? '';
  if (row.entryType === 'compaction') {
    const pairs: Array<[string, string]> = [];
    if (row.workingFiles != null) pairs.push(['files', String(row.workingFiles)]);
    if (row.recentPrompts != null) pairs.push(['prompts', String(row.recentPrompts)]);
    return pairs;
  }
  if (row.entryType === 'directive' && row.promptWords) {
    return `${row.promptWords} words`;
  }
  if (row.entryType === 'compact_boundary' && row.compactPreTokens) {
    return `${fmtNumber(row.compactPreTokens)} tokens`;
  }
  return '';
}

function InfoCell({ preview }: { preview: InfoPreview }) {
  if (typeof preview === 'string') {
    return preview
      ? <span className="font-mono text-text-secondary block truncate">{preview}</span>
      : <span className="text-text-muted">—</span>;
  }
  if (preview.length === 0) return <span className="text-text-muted">—</span>;
  return (
    <span className="font-mono block truncate">
      {preview.map(([k, v], i) => (
        <span key={i} className={i > 0 ? 'ml-4' : undefined}>
          <span className="text-text-muted">{k}</span>
          <span className="text-text-primary ml-1.5">{v}</span>
        </span>
      ))}
    </span>
  );
}

function rowKey(row: EventRow & { _idx?: number }): string {
  return `${row.timestamp}-${row.sessionId}-${row.toolUseId ?? ''}-${row.hookCommand ?? ''}-${row.entryType}-${row._idx ?? 0}`;
}

function ExpandedRow({ row }: { row: EventRow }) {
  const sections: Array<{ label: string; content: string; isError?: boolean; isMarkdown?: boolean }> = [];

  if (row.entryType === 'tool_use') {
    if (row.toolName) sections.push({ label: 'Tool', content: fmtToolName(row.toolName) });
    if (row.skillName) sections.push({ label: 'Skill', content: row.skillName });
    if (row.toolParams) sections.push({ label: 'Parameters', content: JSON.stringify(row.toolParams, null, 2) });
    if (row.toolUseId) sections.push({ label: 'Tool Use ID', content: row.toolUseId });
  } else if (row.entryType === 'tool_result') {
    if (row.toolName) sections.push({ label: 'Tool', content: fmtToolName(row.toolName) });
    if (row.isError) sections.push({ label: 'Error', content: row.errorMessage ?? 'Unknown error', isError: true });
    if (row.resultChars != null) sections.push({ label: 'Result Size', content: `${fmtNumber(row.resultChars)} chars` });
    if (row.resultContent) sections.push({ label: 'Result', content: row.resultContent });
    if (row.toolUseId) sections.push({ label: 'Tool Use ID', content: row.toolUseId });
  } else if (row.entryType === 'hook_progress' || row.entryType === 'stop_hook_summary') {
    if (row.hookEvent) sections.push({ label: 'Event', content: row.hookEvent });
    if (row.hookName) sections.push({ label: 'Hook', content: row.hookName });
    if (row.hookCommand) sections.push({ label: 'Command', content: row.hookCommand });
    if (row.hookDurationMs != null) sections.push({ label: 'Duration', content: fmtMs(row.hookDurationMs) });
    if (row.hookExitCode != null) sections.push({ label: 'Exit Code', content: String(row.hookExitCode), isError: row.hookExitCode !== 0 });
    if (row.hookOutput) sections.push({ label: 'Output', content: row.hookOutput });
  } else if (row.entryType === 'tokens') {
    if (row.model) sections.push({ label: 'Model', content: row.model });
    if (row.inputTokens != null) sections.push({ label: 'Input Tokens', content: fmtNumber(row.inputTokens) });
    if (row.outputTokens != null) sections.push({ label: 'Output Tokens', content: fmtNumber(row.outputTokens) });
    if (row.cacheReadTokens != null && row.cacheReadTokens > 0)
      sections.push({ label: 'Cache Read', content: fmtNumber(row.cacheReadTokens) });
    if (row.cacheCreationTokens != null && row.cacheCreationTokens > 0)
      sections.push({ label: 'Cache Creation', content: fmtNumber(row.cacheCreationTokens) });
  } else if (row.entryType === 'turn_duration') {
    if (row.turnDurationMs != null) sections.push({ label: 'Duration', content: fmtMs(row.turnDurationMs) });
  } else if (row.entryType === 'directive') {
    if (row.directives?.length) sections.push({ label: 'Directives', content: row.directives.join(', ') });
    if (row.promptWords != null) sections.push({ label: 'Prompt Words', content: String(row.promptWords) });
  } else if (row.entryType === 'user_message') {
    const msg = row.userRequest ?? row.text;
    if (msg) sections.push({ label: 'Message', content: msg, isMarkdown: true });
  } else if (row.entryType === 'assistant_message') {
    if (row.text) sections.push({ label: 'Message', content: row.text, isMarkdown: true });
  } else if (row.entryType === 'hook_event') {
    if (row.hookName) sections.push({ label: 'Hook', content: row.hookName });
    if (row.hookEvent) sections.push({ label: 'Event', content: row.hookEvent });
    if (row.hook && row.hook !== row.hookName) sections.push({ label: 'Source', content: row.hook });
  } else if (row.entryType === 'hook_feedback') {
    if (row.name) sections.push({ label: 'Kind', content: row.name });
    if (row.text) sections.push({ label: 'Text', content: row.text });
  } else if (row.entryType === 'gate' || row.entryType === 'gate_marker') {
    if (row.hookName) sections.push({ label: 'Hook', content: row.hookName });
    if (row.hookEvent) sections.push({ label: 'Event', content: row.hookEvent });
    if (row.tier != null) sections.push({ label: 'Tier', content: String(row.tier) });
    if (row.decision) sections.push({ label: 'Decision', content: row.decision, isError: row.decision === 'block' });
    if (row.reason) sections.push({ label: 'Reason', content: row.reason });
  } else if (row.entryType === 'feedback') {
    if (row.polarity) sections.push({ label: 'Polarity', content: row.polarity });
    if (row.target) sections.push({ label: 'Target', content: row.target });
  } else if (row.entryType === 'rating') {
    if (row.rating != null) sections.push({ label: 'Rating', content: String(row.rating) });
  } else if (row.entryType === 're_edit') {
    if (row.file) sections.push({ label: 'File', content: row.file });
  } else if (row.entryType === 'memory_write') {
    if (row.memoryType) sections.push({ label: 'Type', content: row.memoryType });
    if (row.memoryId) sections.push({ label: 'Memory ID', content: row.memoryId });
  } else if (row.entryType === 'compaction') {
    if (row.hookName) sections.push({ label: 'Hook', content: row.hookName });
    if (row.workingFiles != null) sections.push({ label: 'Working Files', content: String(row.workingFiles) });
    if (row.recentPrompts != null) sections.push({ label: 'Recent Prompts', content: String(row.recentPrompts) });
  } else if (row.entryType === 'compact_boundary') {
    if (row.compactTrigger) sections.push({ label: 'Trigger', content: row.compactTrigger });
    if (row.compactPreTokens != null) sections.push({ label: 'Pre-Compact Tokens', content: fmtNumber(row.compactPreTokens) });
  }

  sections.push({ label: 'Session', content: row.sessionId });
  if (row.project) sections.push({ label: 'Project', content: row.project });

  if (sections.length === 0) {
    return <span className="text-text-muted text-xs">No additional data</span>;
  }

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs max-w-2xl">
      {sections.map((s) => (
        <div key={s.label} className="contents">
          <span className="text-text-muted font-medium whitespace-nowrap">{s.label}</span>
          {s.isMarkdown ? (
            <div className="text-text-secondary
              [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-1
              [&_code]:font-mono [&_code]:bg-bg-tertiary [&_code]:px-1 [&_code]:rounded [&_code]:text-accent [&_code]:text-xs
              [&_pre]:bg-bg-tertiary [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0
              [&_ul]:list-disc [&_ul]:ml-4 [&_ul]:mb-1 [&_ol]:list-decimal [&_ol]:ml-4 [&_ol]:mb-1
              [&_strong]:font-semibold [&_strong]:text-text-primary">
              <Markdown remarkPlugins={[remarkGfm]}>{s.content}</Markdown>
            </div>
          ) : s.content.includes('\n') || s.content.length > 80 ? (
            <pre className={clsx(
              'font-mono whitespace-pre-wrap break-all max-h-48 overflow-auto rounded bg-bg-tertiary px-2 py-1',
              s.isError && 'text-error'
            )}>
              {s.content}
            </pre>
          ) : (
            <span className={clsx('font-mono text-text-primary', s.isError && 'text-error font-medium')}>
              {s.content}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

const PAGE_SIZE = 100;

function Pagination({ start, end, total, hasPrev, hasNext, onPrev, onNext }: {
  start: number;
  end: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-text-muted">
        {total === 0 ? 'No events' : `Showing ${start}–${end} of ${fmtNumber(total)}`}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          disabled={!hasPrev}
          className="px-3 py-1 text-xs rounded-md border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Previous
        </button>
        <button
          onClick={onNext}
          disabled={!hasNext}
          className="px-3 py-1 text-xs rounded-md border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function EventsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const range = (searchParams.get('range') as TimeRange) ?? '30d';
  const granularity = (searchParams.get('granularity') as Granularity) ?? 'day';
  function setRange(r: TimeRange) { setSearchParams(p => { const n = new URLSearchParams(p); n.set('range', r); return n; }, { replace: true }); }
  function setGranularity(g: Granularity) { setSearchParams(p => { const n = new URLSearchParams(p); n.set('granularity', g); return n; }, { replace: true }); }
  const [activeType, setActiveType] = useState<EntryType | undefined>(undefined);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setOffset(0);
    }, 300);
  }, []);

  const handleTypeToggle = (type: EntryType) => {
    setActiveType((prev) => (prev === type ? undefined : type));
    setOffset(0);
  };

  const { data, isLoading, error, refetch } = useObsEvents(
    range,
    { entryType: activeType, search: debouncedSearch || undefined },
    PAGE_SIZE,
    offset,
  );

  const [chartDataset, setChartDataset] = useState<EventsDataset>('activity');
  const sessions = useObsSessions(range, granularity);
  const tokens = useObsTokens(range, granularity);

  const allEvents = (data?.events ?? []).map((e: EventRow, i: number) => ({ ...e, _idx: i }));
  const events = errorsOnly ? allEvents.filter((e) => e.isError) : allEvents;
  const total = errorsOnly ? events.length : (data?.total ?? 0);
  const errorCount = allEvents.filter((e) => e.isError).length;

  const typeCounts = allEvents.reduce<Record<string, number>>((acc, e) => {
    acc[e.entryType] = (acc[e.entryType] ?? 0) + 1;
    return acc;
  }, {});
  const allDonutData = Object.entries(typeCounts)
    .map(([type, count]) => ({ type, count, label: TYPE_LABELS[type as EntryType] ?? type }))
    .sort((a, b) => b.count - a.count);
  const topDonut = allDonutData.slice(0, 5);
  const otherCount = allDonutData.slice(5).reduce((s, r) => s + r.count, 0);
  const donutData = otherCount > 0
    ? [...topDonut, { type: 'other', count: otherCount, label: 'Other' }]
    : topDonut;

  const columns: Column<EventRow>[] = [
    {
      key: 'timestamp',
      label: 'Time',
      width: '175px',
      render: (row) => (
        <span className="font-mono text-text-secondary whitespace-nowrap">{dateTime(row.timestamp)}</span>
      ),
    },
    {
      key: 'entryType',
      label: 'Type',
      width: '130px',
      render: (row) => <TypeBadge type={row.entryType} isError={row.isError} />,
    },
    {
      key: 'detail',
      label: 'Detail',
      width: '360px',
      render: (row) => {
        const detail = getDetail(row);
        return detail
          ? <span className="font-mono text-text-primary truncate block">{detail}</span>
          : <span className="text-text-muted">—</span>;
      },
    },
    {
      key: 'info',
      label: 'Parameters',
      render: (row) => <InfoCell preview={getInfoPreview(row)} />,
    },
    {
      key: 'sessionId',
      label: 'Session',
      width: '110px',
      render: (row) => (
        <span className="font-mono text-text-muted whitespace-nowrap">{row.sessionId.slice(0, 8)}</span>
      ),
    },
  ];

  const start = total === 0 ? 0 : offset + 1;
  const end = errorsOnly ? total : Math.min(offset + PAGE_SIZE, total);
  const hasPrev = !errorsOnly && offset > 0;
  const hasNext = !errorsOnly && offset + PAGE_SIZE < (data?.total ?? 0);

  const activityData = sessions.data?.byActivity ?? [];

  const eventFilters = (
    <>
      {EVENT_TYPES.map((type) => (
        <FilterToggle
          key={type}
          label={TYPE_LABELS[type]}
          active={activeType === type}
          onToggle={() => handleTypeToggle(type)}
        />
      ))}
      {errorCount > 0 && (
        <FilterToggle
          label={`Errors (${errorCount})`}
          active={errorsOnly}
          onToggle={() => { setErrorsOnly(!errorsOnly); setOffset(0); }}
          activeColor="error"
        />
      )}
      <input
        type="text"
        value={search}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Search…"
        className="px-2.5 py-0.5 text-xs rounded border border-border-primary bg-bg-secondary text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent w-32"
      />
    </>
  );

  return (
    <div className="space-y-6">
      <ObsControlBar
        title="Events"
        range={range}
        onRangeChange={(r) => { setRange(r); setOffset(0); }}
        granularity={granularity}
        onGranularityChange={setGranularity}
        datasets={EVENTS_DATASETS}
        dataset={chartDataset}
        onDatasetChange={(d) => setChartDataset(d as EventsDataset)}
        filters={eventFilters}
        activeFilterCount={(activeType ? 1 : 0) + (errorsOnly ? 1 : 0) + (search ? 1 : 0)}
      />

      <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 h-[350px] flex flex-col">
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <h3 className="font-heading text-lg font-medium text-text-secondary">
                {chartDataset === 'tokens'
                  ? `${GRAN_LABEL[granularity] ?? 'Daily'} Token Usage`
                  : `${GRAN_LABEL[granularity] ?? 'Daily'} Activity by Day`}
              </h3>
            </div>
            <div className="h-1" />
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                {chartDataset === 'tokens' && tokens.data ? (
                  <AreaChart data={tokens.data.byDay}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...xAxisDateProps} />
                    <YAxis {...axisProps} tickFormatter={fmtNumber} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                    <Area isAnimationActive={false} type="monotone" dataKey="input" stackId="t" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.4} strokeWidth={1.5} dot={false} name="Input" />
                    <Area isAnimationActive={false} type="monotone" dataKey="output" stackId="t" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.4} strokeWidth={1.5} dot={false} name="Output" />
                    <Area isAnimationActive={false} type="monotone" dataKey="cacheRead" stackId="t" stroke={CHART_PALETTE[2]} fill={CHART_PALETTE[2]} fillOpacity={0.4} strokeWidth={1.5} dot={false} name="Cache Read" />
                  </AreaChart>
                ) : (
                  <AreaChart data={activityData}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...xAxisDateProps} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    <Area isAnimationActive={false} type="monotone" dataKey="count" stroke={CHART_PALETTE[2]} fill={CHART_PALETTE[2]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Events" />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          <div className="w-px bg-border-primary shrink-0 mx-5" />

          <div className="w-[360px] shrink-0 flex flex-col">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h3 className="font-heading text-lg font-medium text-text-secondary">
                {chartDataset === 'tokens' ? 'Token Breakdown' : 'Events by Type'}
              </h3>
            </div>
            {chartDataset === 'tokens' && tokens.data ? (() => {
              const tokenBreakdown = [
                { label: 'Input', count: tokens.data.totalInput, color: CHART_PALETTE[0] },
                { label: 'Output', count: tokens.data.totalOutput, color: CHART_PALETTE[1] },
                { label: 'Cache Read', count: tokens.data.totalCacheRead, color: CHART_PALETTE[2] },
                { label: 'Cache Creation', count: tokens.data.totalCacheCreation, color: CHART_PALETTE[3] },
              ].filter(r => r.count > 0);
              return (
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie isAnimationActive={false} data={tokenBreakdown} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                        {tokenBreakdown.map((r, i) => <Cell key={i} fill={r.color} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              );
            })() : donutData.length > 0 ? (
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie isAnimationActive={false} data={donutData} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                      {donutData.map((entry, i) => <Cell key={i} fill={entry.type === 'other' ? CHART_OTHER : CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-center gap-x-2 gap-y-[5px] mt-1 mb-1 text-xs shrink-0 flex-wrap">
          {chartDataset === 'tokens' ? (
            <>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: CHART_PALETTE[0] }} />Input</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: CHART_PALETTE[1] }} />Output</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: CHART_PALETTE[2] }} />Cache Read</span>
            </>
          ) : (
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: CHART_PALETTE[2] }} />Events</span>
          )}
        </div>
      </div>

      {isLoading ? (
        <PageLoading />
      ) : error ? (
        <ErrorState message="Failed to load events" retry={refetch} />
      ) : (
        <>
          {!errorsOnly && (
            <Pagination
              start={start}
              end={end}
              total={total}
              hasPrev={hasPrev}
              hasNext={hasNext}
              onPrev={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              onNext={() => setOffset((o) => o + PAGE_SIZE)}
            />
          )}
          {errorsOnly && (
            <span className="text-sm text-text-muted">
              {total === 0 ? 'No events' : `Showing ${start}–${end} of ${fmtNumber(total)}`}
            </span>
          )}

          <DataTable<EventRow>
            data={events}
            columns={columns}
            keyField="timestamp"
            rowKeyFn={rowKey}
            rowClassName={(row) => row.isError ? 'bg-error/5' : undefined}
            expandedKey={expandedKey}
            onExpandToggle={setExpandedKey}
            renderExpanded={(row) => <ExpandedRow row={row} />}
          />

          {!errorsOnly && total > PAGE_SIZE && (
            <div className="pt-1">
              <Pagination
                start={start}
                end={end}
                total={total}
                hasPrev={hasPrev}
                hasNext={hasNext}
                onPrev={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                onNext={() => setOffset((o) => o + PAGE_SIZE)}
              />
            </div>
          )}
        </>
      )}

      {data?.queryTimeMs != null && <QueryTiming ms={data.queryTimeMs} />}
    </div>
  );
}
