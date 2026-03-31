import { useState, useCallback, useRef } from 'react';
import { useObsEvents } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { type TimeRange } from '../../../components/data/TimeRangeSelector';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { dateTime, fmtNumber, fmtMs, fmtToolName } from '../../../utils/format';
import { clsx } from 'clsx';

type EntryType =
  | 'tool_use'
  | 'tool_result'
  | 'hook_progress'
  | 'stop_hook_summary'
  | 'tokens'
  | 'turn_duration'
  | 'directive'
  | 'user_message'
  | 'compact_boundary';

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
  hookEvent?: string;
  hookName?: string;
  hookCommand?: string;
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
  compactTrigger?: string;
  compactPreTokens?: number;
};

const EVENT_TYPES: EntryType[] = [
  'tool_use',
  'tool_result',
  'hook_progress',
  'stop_hook_summary',
  'tokens',
  'turn_duration',
  'directive',
  'user_message',
  'compact_boundary',
];

const TYPE_LABELS: Record<EntryType, string> = {
  tool_use: 'tool_use',
  tool_result: 'tool_result',
  hook_progress: 'hook_progress',
  stop_hook_summary: 'stop_hook',
  tokens: 'tokens',
  turn_duration: 'turn',
  directive: 'directive',
  user_message: 'message',
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
    tokens: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    turn_duration: 'bg-bg-tertiary text-text-muted border-border-primary',
    directive: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    user_message: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
    compact_boundary: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  };

  const label = TYPE_LABELS[type as EntryType] ?? type;
  const cls = classes[type] ?? 'bg-bg-tertiary text-text-muted border-border-primary';

  return (
    <span className={clsx('inline-block px-1.5 py-0.5 text-[10px] font-mono rounded border whitespace-nowrap', cls)}>
      {label}
    </span>
  );
}

function getDetail(row: EventRow): string {
  switch (row.entryType) {
    case 'tool_use':
      return row.skillName ? `Skill: ${row.skillName}` : (row.toolName ? fmtToolName(row.toolName) : '');
    case 'tool_result':
      return row.isError ? (row.errorMessage?.slice(0, 60) ?? 'error') : 'ok';
    case 'hook_progress':
      return row.hookCommand?.split('/').pop()?.slice(0, 40) ?? row.hookEvent ?? '';
    case 'stop_hook_summary':
      return row.hookCommand?.split('/').pop()?.slice(0, 40) ?? '';
    case 'tokens':
      return row.model ?? '';
    case 'turn_duration':
      return row.turnDurationMs != null ? fmtMs(row.turnDurationMs) : '';
    case 'directive':
      return row.directives?.join(', ') ?? '';
    case 'user_message':
      return row.userRequest?.slice(0, 60) ?? '';
    case 'compact_boundary':
      return row.compactTrigger ?? '';
    default:
      return '';
  }
}

function getInfoPreview(row: EventRow): string {
  if (row.entryType === 'tool_use' && row.toolParams) {
    const s = JSON.stringify(row.toolParams);
    return s.length > 60 ? s.slice(0, 60) + '…' : s;
  }
  if (row.entryType === 'stop_hook_summary' && row.hookOutput) {
    return row.hookOutput.slice(0, 60) + (row.hookOutput.length > 60 ? '…' : '');
  }
  if (row.entryType === 'tokens') {
    return [
      row.inputTokens != null && `in:${fmtNumber(row.inputTokens)}`,
      row.outputTokens != null && `out:${fmtNumber(row.outputTokens)}`,
      row.cacheReadTokens != null && row.cacheReadTokens > 0 && `cr:${fmtNumber(row.cacheReadTokens)}`,
    ].filter(Boolean).join(' ');
  }
  if (row.entryType === 'hook_progress') {
    return [row.hookEvent, row.hookName].filter(Boolean).join(' / ');
  }
  if (row.entryType === 'tool_result' && row.errorMessage) {
    return row.errorMessage.slice(0, 60) + (row.errorMessage.length > 60 ? '…' : '');
  }
  if (row.entryType === 'directive' && row.promptWords) {
    return `${row.promptWords} words`;
  }
  if (row.entryType === 'compact_boundary' && row.compactPreTokens) {
    return `${fmtNumber(row.compactPreTokens)} tokens`;
  }
  return '';
}

function rowKey(row: EventRow & { _idx?: number }): string {
  return `${row.timestamp}-${row.sessionId}-${row.toolUseId ?? ''}-${row.hookCommand ?? ''}-${row.entryType}-${row._idx ?? 0}`;
}

function ExpandedRow({ row }: { row: EventRow }) {
  const sections: Array<{ label: string; content: string; isError?: boolean }> = [];

  if (row.entryType === 'tool_use') {
    if (row.toolName) sections.push({ label: 'Tool', content: fmtToolName(row.toolName) });
    if (row.skillName) sections.push({ label: 'Skill', content: row.skillName });
    if (row.toolParams) sections.push({ label: 'Parameters', content: JSON.stringify(row.toolParams, null, 2) });
    if (row.toolUseId) sections.push({ label: 'Tool Use ID', content: row.toolUseId });
  } else if (row.entryType === 'tool_result') {
    if (row.toolName) sections.push({ label: 'Tool', content: fmtToolName(row.toolName) });
    if (row.isError) sections.push({ label: 'Error', content: row.errorMessage ?? 'Unknown error', isError: true });
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
    if (row.userRequest) sections.push({ label: 'Message', content: row.userRequest });
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
          {s.content.includes('\n') || s.content.length > 80 ? (
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
  const [range, setRange] = useState<TimeRange>('30d');
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

  const allEvents = (data?.events ?? []).map((e: EventRow, i: number) => ({ ...e, _idx: i }));
  const events = errorsOnly ? allEvents.filter((e) => e.isError) : allEvents;
  const total = errorsOnly ? events.length : (data?.total ?? 0);
  const errorCount = allEvents.filter((e) => e.isError).length;

  const columns: Column<EventRow>[] = [
    {
      key: 'timestamp',
      label: 'Time',
      width: '160px',
      render: (row) => (
        <span className="text-text-secondary text-xs whitespace-nowrap">{dateTime(row.timestamp)}</span>
      ),
    },
    {
      key: 'entryType',
      label: 'Type',
      width: '110px',
      render: (row) => <TypeBadge type={row.entryType} isError={row.isError} />,
    },
    {
      key: 'detail',
      label: 'Detail',
      width: '140px',
      render: (row) => {
        const detail = getDetail(row);
        return detail
          ? <span className="font-mono text-xs text-text-primary truncate block">{detail}</span>
          : <span className="text-text-muted">—</span>;
      },
    },
    {
      key: 'info',
      label: 'Info',
      render: (row) => {
        const preview = getInfoPreview(row);
        return preview
          ? <span className="font-mono text-xs text-text-muted block truncate">{preview}</span>
          : <span className="text-text-muted">—</span>;
      },
    },
    {
      key: 'sessionId',
      label: 'Session',
      width: '90px',
      render: (row) => (
        <span className="font-mono text-xs text-text-muted">{row.sessionId.slice(0, 8)}</span>
      ),
    },
  ];

  const start = total === 0 ? 0 : offset + 1;
  const end = errorsOnly ? total : Math.min(offset + PAGE_SIZE, total);
  const hasPrev = !errorsOnly && offset > 0;
  const hasNext = !errorsOnly && offset + PAGE_SIZE < (data?.total ?? 0);

  return (
    <div className="space-y-4">
      <ObsControlBar title={<h1 className="text-2xl font-bold text-text-primary">Events</h1>} range={range} onRangeChange={(r) => { setRange(r); setOffset(0); }}>
        <div className="flex items-center gap-1.5 flex-wrap">
          {EVENT_TYPES.map((type) => (
            <FilterToggle
              key={type}
              label={TYPE_LABELS[type]}
              active={activeType === type}
              onToggle={() => handleTypeToggle(type)}
            />
          ))}
        </div>
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
          className="px-2.5 py-1 text-xs rounded-md border border-border-primary bg-bg-secondary text-text-primary placeholder-text-muted focus:outline-none focus:border-accent w-40"
        />
      </ObsControlBar>

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
