import { useState, useCallback } from 'react';
import { useObsEvents } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { dateTime, fmtNumber, fmtMs } from '../../../utils/format';
import { cn } from '../../../utils/cn';

type EntryType =
  | 'tool_use'
  | 'tool_result'
  | 'hook_progress'
  | 'stop_hook_summary'
  | 'tokens'
  | 'turn_duration';

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
};

const EVENT_TYPES: EntryType[] = [
  'tool_use',
  'tool_result',
  'hook_progress',
  'stop_hook_summary',
  'tokens',
  'turn_duration',
];

const TYPE_LABELS: Record<EntryType, string> = {
  tool_use: 'tool_use',
  tool_result: 'tool_result',
  hook_progress: 'hook_progress',
  stop_hook_summary: 'stop_hook',
  tokens: 'tokens',
  turn_duration: 'turn',
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
  };

  const label = TYPE_LABELS[type as EntryType] ?? type;
  const cls = classes[type] ?? 'bg-bg-tertiary text-text-muted border-border-primary';

  return (
    <span className={cn('inline-block px-1.5 py-0.5 text-[10px] font-mono rounded border whitespace-nowrap', cls)}>
      {label}
    </span>
  );
}

function getDetail(row: EventRow): string {
  switch (row.entryType) {
    case 'tool_use':
      return row.skillName ? `Skill: ${row.skillName}` : (row.toolName ?? '');
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
    default:
      return '';
  }
}

function InfoCell({ row, expandedKey, onToggle }: { row: EventRow; expandedKey: string; onToggle: (k: string) => void }) {
  const key = `${row.timestamp}-${row.sessionId}-${row.toolUseId ?? row.entryType}`;
  const isExpanded = expandedKey === key;

  let preview = '';
  let full = '';

  if (row.entryType === 'tool_use' && row.toolParams) {
    full = JSON.stringify(row.toolParams, null, 2);
    preview = JSON.stringify(row.toolParams);
    if (preview.length > 60) preview = preview.slice(0, 60) + '…';
  } else if (row.entryType === 'stop_hook_summary' && row.hookOutput) {
    full = row.hookOutput;
    preview = row.hookOutput.slice(0, 60) + (row.hookOutput.length > 60 ? '…' : '');
  } else if (row.entryType === 'tokens') {
    const parts = [
      row.inputTokens != null && `in:${fmtNumber(row.inputTokens)}`,
      row.outputTokens != null && `out:${fmtNumber(row.outputTokens)}`,
      row.cacheReadTokens != null && row.cacheReadTokens > 0 && `cr:${fmtNumber(row.cacheReadTokens)}`,
    ].filter(Boolean);
    preview = parts.join(' ');
    full = preview;
  } else if (row.entryType === 'hook_progress') {
    preview = [row.hookEvent, row.hookName].filter(Boolean).join(' / ');
    full = preview;
  } else if (row.entryType === 'tool_result' && row.errorMessage) {
    full = row.errorMessage;
    preview = row.errorMessage.slice(0, 60) + (row.errorMessage.length > 60 ? '…' : '');
  }

  if (!preview) return <span className="text-text-muted">—</span>;

  const isExpandable = full !== preview || full.includes('\n');

  if (!isExpandable) {
    return <span className="font-mono text-xs text-text-muted">{preview}</span>;
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(isExpanded ? '' : key); }}
      className="w-full text-left font-mono text-xs text-text-muted hover:text-text-primary"
    >
      {isExpanded ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">{full}</pre>
      ) : (
        <span className="block truncate">{preview}</span>
      )}
    </button>
  );
}

const PAGE_SIZE = 100;

export function EventsPage() {
  const [days, setDays] = useState(30);
  const [activeType, setActiveType] = useState<EntryType | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [expandedKey, setExpandedKey] = useState('');

  const debounceRef = { current: undefined as ReturnType<typeof setTimeout> | undefined };

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
    days,
    { entryType: activeType, search: debouncedSearch || undefined },
    PAGE_SIZE,
    offset,
  );

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
      render: (row) => {
        const detail = getDetail(row);
        return detail
          ? <span className="font-mono text-xs text-text-primary truncate block max-w-xs">{detail}</span>
          : <span className="text-text-muted">—</span>;
      },
    },
    {
      key: 'info',
      label: 'Info',
      render: (row) => <InfoCell row={row} expandedKey={expandedKey} onToggle={setExpandedKey} />,
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

  const total = data?.total ?? 0;
  const events = data?.events ?? [];
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + PAGE_SIZE, total);
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-4">
      <ObsControlBar days={days} onDaysChange={(d) => { setDays(d); setOffset(0); }}>
        <h1 className="text-lg font-semibold text-text-primary">Events</h1>
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
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">
              {total === 0
                ? 'No events'
                : `Showing ${start}–${end} of ${fmtNumber(total)}`}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={!hasPrev}
                className="px-3 py-1 text-xs rounded-md border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={!hasNext}
                className="px-3 py-1 text-xs rounded-md border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>

          <DataTable<EventRow>
            data={events}
            columns={columns}
            keyField="timestamp"
            rowClassName={(row) => row.isError ? 'bg-error/5' : undefined}
          />

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-text-muted">
                {`Showing ${start}–${end} of ${fmtNumber(total)}`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                  disabled={!hasPrev}
                  className="px-3 py-1 text-xs rounded-md border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                  disabled={!hasNext}
                  className="px-3 py-1 text-xs rounded-md border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {data?.queryTimeMs != null && <QueryTiming ms={data.queryTimeMs} />}
    </div>
  );
}
