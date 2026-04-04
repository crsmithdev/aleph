import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useObsSessionTrace } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { type TimeRange } from '../../../components/data/TimeRangeSelector';
import { fmtNumber, fmtMs, fmtCurrency, dateTime, fmtDuration, fmtToolName, cleanMessage } from '../../../utils/format';
import { clsx } from 'clsx';

type Span = {
  id: string;
  kind: 'tool' | 'hook' | 'token';
  label: string;
  startMs: number;
  durationMs: number;
  isError?: boolean;
  detail?: string;
  subagentSessionId?: string;
};

type Turn = {
  index: number;
  userMessage: string;
  startTime: string;
  durationMs: number;
  spans: Span[];
  tokenCount?: number;
  contextTokens?: number;
  outputTokens?: number;
  cost?: number;
  model?: string;
};

// ── Span row inside expanded response ─────────────────────────────────────────

function SpanRow({ span, sessionId }: { span: Span; sessionId: string }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!span.detail || !!span.subagentSessionId;
  const isSubagent = span.kind === 'tool' && span.label === 'Agent';

  const kindStyle =
    span.isError
      ? 'bg-error/10 border-error/30 text-error'
      : span.kind === 'hook'
      ? 'bg-purple-500/10 border-purple-500/30 text-purple-400'
      : isSubagent
      ? 'bg-agent/20 border-agent-border text-white'
      : 'bg-accent/10 border-accent/30 text-accent';

  return (
    <>
      <div
        className={clsx(
          'flex items-center gap-2 px-4 py-2 border-b border-border-primary/20 last:border-b-0 text-xs',
          hasDetail && 'cursor-pointer hover:bg-bg-tertiary/30',
        )}
        onClick={() => hasDetail && setOpen(!open)}
      >
        {/* Kind badge */}
        <span
          className={clsx(
            'shrink-0 inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wide',
            kindStyle,
          )}
        >
          {isSubagent ? 'agent' : span.kind}
        </span>

        {/* Name */}
        <span className={clsx('font-mono shrink-0', span.isError ? 'text-error' : 'text-text-primary')}>
          {span.subagentSessionId ? (
            <Link
              to={`/observability/sessions/${encodeURIComponent(span.subagentSessionId)}`}
              className="text-accent hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {fmtToolName(span.label)}
            </Link>
          ) : (
            fmtToolName(span.label)
          )}
        </span>

        {/* Inline detail preview */}
        {span.detail && !open && (
          <span className="text-text-muted truncate flex-1 min-w-0">
            {span.detail.replace(/^(command|description|file_path|content|pattern|query|url|path|prompt|message):\s*/gmi, '').slice(0, 80)}
          </span>
        )}

        {/* Right side: status dot + duration + expand caret */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className={clsx('w-1.5 h-1.5 rounded-full', span.isError ? 'bg-error' : 'bg-green-500')} />
          {span.durationMs > 0 && (
            <span className="text-text-disabled font-mono">{fmtMs(span.durationMs)}</span>
          )}
          {hasDetail && (
            <span className={clsx('text-text-disabled transition-transform', open && 'rotate-90')}>›</span>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="px-4 pb-3 pt-1 bg-bg-primary/50">
          {span.subagentSessionId && (
            <div className="mb-2 text-xs font-mono text-text-muted">
              Subagent:{' '}
              <Link
                to={`/observability/sessions/${encodeURIComponent(span.subagentSessionId)}`}
                className="text-accent hover:underline"
              >
                {span.subagentSessionId.slice(0, 16)}…
              </Link>
            </div>
          )}
          {span.detail && (
            <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-all bg-bg-secondary p-2 rounded border border-border-primary/30 max-h-48 overflow-auto">
              {span.detail
                .replace(/^(command|description|file_path|content|pattern|query|url|path|prompt|message):\s*/gmi, '')
                .trim()}
            </pre>
          )}
        </div>
      )}
    </>
  );
}

// ── Response block (collapsed/expanded) ───────────────────────────────────────

function ResponseBlock({
  turn,
  expanded,
  onToggle,
  sessionId,
  prevContextTokens,
}: {
  turn: Turn;
  expanded: boolean;
  onToggle: () => void;
  sessionId: string;
  prevContextTokens?: number;
}) {
  const toolSpans = turn.spans.filter((s) => s.kind === 'tool');
  const hookSpans = turn.spans.filter((s) => s.kind === 'hook');
  const errorCount = turn.spans.filter((s) => s.isError).length;

  // Context delta: how many tokens were added to input context since last turn
  const ctxDelta =
    turn.contextTokens && prevContextTokens ? turn.contextTokens - prevContextTokens : undefined;

  const summaryParts: string[] = [];
  if (toolSpans.length > 0) summaryParts.push(`${toolSpans.length} tool${toolSpans.length !== 1 ? 's' : ''}`);
  if (hookSpans.length > 0) summaryParts.push(`${hookSpans.length} hook${hookSpans.length !== 1 ? 's' : ''}`);

  return (
    <div className="rounded-sm border border-border-primary bg-bg-secondary overflow-hidden ml-2">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-bg-tertiary/30 transition-colors"
      >
        {/* Model badge */}
        <span className="text-xs text-text-muted font-mono shrink-0">
          {turn.model ? turn.model.replace('claude-', '') : 'Claude'}
        </span>

        {/* Summary: tools + hooks */}
        {summaryParts.length > 0 && (
          <span className="text-xs text-text-secondary shrink-0">· {summaryParts.join(', ')}</span>
        )}

        {errorCount > 0 && (
          <span className="text-xs text-error shrink-0">· {errorCount} error{errorCount !== 1 ? 's' : ''}</span>
        )}

        {/* Context delta badge */}
        {ctxDelta !== undefined && ctxDelta > 0 && (
          <span className="shrink-0 text-[10px] rounded px-1.5 py-0.5 bg-bg-tertiary border border-border-primary text-text-muted font-mono">
            Context +{fmtNumber(ctxDelta)}
          </span>
        )}

        {/* Right: tokens / cost / duration / chevron */}
        <div className="ml-auto flex items-center gap-3 text-xs text-text-muted shrink-0">
          {turn.contextTokens && (
            <span className="font-mono">{fmtNumber(turn.contextTokens)}↑</span>
          )}
          {turn.cost && turn.cost > 0 ? (
            <span className="font-mono">{fmtCurrency(turn.cost)}</span>
          ) : null}
          <span className="font-mono">{fmtMs(turn.durationMs)}</span>
          <span className={clsx('transition-transform', expanded ? 'rotate-180' : '')}>⌄</span>
        </div>
      </button>

      {/* Expanded spans */}
      {expanded && turn.spans.length > 0 && (
        <div className="border-t border-border-primary">
          {turn.spans.map((span, i) => (
            <SpanRow key={`${span.id}-${i}`} span={span} sessionId={sessionId} />
          ))}
        </div>
      )}

      {expanded && turn.spans.length === 0 && (
        <div className="border-t border-border-primary px-4 py-3 text-xs text-text-muted italic">
          No tool or hook calls in this turn
        </div>
      )}
    </div>
  );
}

// ── Inline markdown: bold only ─────────────────────────────────────────────────

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}

// ── User message block ─────────────────────────────────────────────────────────

function UserBlock({ turn }: { turn: Turn }) {
  const msg = cleanMessage(turn.userMessage);
  const time = dateTime(turn.startTime);

  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] bg-bg-secondary border-l-4 border-accent rounded-sm px-4 py-3">
        <div className="flex items-center justify-between gap-4 mb-1">
          <span className="font-mono text-[11px] text-accent tracking-wider uppercase">You</span>
          <span className="text-[11px] text-text-muted">{time}</span>
        </div>
        {msg ? (
          <p className="text-sm text-text-primary whitespace-pre-wrap break-words leading-relaxed">
            <InlineMarkdown text={msg} />
          </p>
        ) : (
          <span className="text-sm text-text-muted italic">no message</span>
        )}
      </div>
    </div>
  );
}

// ── Context panel ──────────────────────────────────────────────────────────────

type ContextItem = {
  type: 'user' | 'tool';
  turnIndex: number;
  label: string;
  preview?: string;
  estTokens: number;
};

function ContextPanel({ turns }: { turns: Turn[] }) {
  const [view, setView] = useState<'category' | 'size'>('category');
  const [grouping, setGrouping] = useState<'grouped' | 'flat'>('grouped');

  const lastTurn = turns[turns.length - 1];
  const totalContextTokens = lastTurn?.contextTokens;

  // Build items from what we have
  const userItems: ContextItem[] = turns
    .filter((t) => cleanMessage(t.userMessage).length > 0)
    .map((t) => {
      const text = cleanMessage(t.userMessage);
      return {
        type: 'user',
        turnIndex: t.index,
        label: `@Turn ${t.index + 1}`,
        preview: text.slice(0, 70),
        estTokens: Math.ceil(text.length / 4),
      };
    });

  const toolItems: ContextItem[] = turns
    .filter((t) => t.spans.some((s) => s.kind === 'tool'))
    .map((t) => {
      const toolSpans = t.spans.filter((s) => s.kind === 'tool');
      const estTokens = toolSpans.reduce(
        (sum, s) => sum + Math.ceil((s.detail || '').length / 4),
        0,
      );
      return {
        type: 'tool',
        turnIndex: t.index,
        label: `@Turn ${t.index + 1}`,
        preview: `${toolSpans.length} tool${toolSpans.length !== 1 ? 's' : ''}`,
        estTokens,
      };
    });

  const totalUserEst = userItems.reduce((s, i) => s + i.estTokens, 0);
  const totalToolEst = toolItems.reduce((s, i) => s + i.estTokens, 0);

  // Flat sorted view
  const flatItems = [...userItems, ...toolItems].sort((a, b) =>
    view === 'size' ? b.estTokens - a.estTokens : a.turnIndex - b.turnIndex,
  );

  const sortedUserItems =
    view === 'size' ? [...userItems].sort((a, b) => b.estTokens - a.estTokens) : userItems;
  const sortedToolItems =
    view === 'size' ? [...toolItems].sort((a, b) => b.estTokens - a.estTokens) : toolItems;

  const showFlat = grouping === 'flat' || view === 'category';

  return (
    <div className="rounded-sm border border-border-primary bg-bg-secondary overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border-primary">
        <h2 className="text-sm font-medium text-text-secondary">Visible Context</h2>
        {totalContextTokens ? (
          <span className="text-xs text-text-muted">
            ~{fmtNumber(totalContextTokens)} total tokens
          </span>
        ) : (
          <span className="text-xs text-text-disabled">token data unavailable</span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {(['category', 'size'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={clsx(
                'px-2 py-0.5 rounded text-xs border transition-colors',
                view === v
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border-primary bg-bg-tertiary text-text-muted',
              )}
            >
              {v === 'category' ? 'Category' : 'By Size'}
            </button>
          ))}
        </div>

        {view === 'size' && (
          <div className="flex items-center gap-1">
            {(['grouped', 'flat'] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGrouping(g)}
                className={clsx(
                  'px-2 py-0.5 rounded text-xs border transition-colors',
                  grouping === g
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-border-primary bg-bg-tertiary text-text-muted',
                )}
              >
                {g === 'grouped' ? 'Grouped' : 'Flat'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="divide-y divide-border-primary/20">
        {view === 'category' || grouping === 'grouped' ? (
          <>
            {/* User Messages group */}
            <ContextGroup
              label="User Messages"
              count={userItems.length}
              totalEst={totalUserEst}
              items={sortedUserItems}
              view={view}
            />

            {/* Tool Outputs group */}
            <ContextGroup
              label="Tool Calls"
              count={toolItems.length}
              totalEst={totalToolEst}
              items={sortedToolItems}
              view={view}
              note="estimated from param text"
            />
          </>
        ) : (
          /* Flat view */
          <div className="px-4 py-2 space-y-0">
            {flatItems.map((item, i) => (
              <FlatContextItem key={i} item={item} />
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-t border-border-primary text-[11px] text-text-disabled">
        Token counts estimated from user message text; tool output size not tracked in telemetry
      </div>
    </div>
  );
}

function ContextGroup({
  label,
  count,
  totalEst,
  items,
  view,
  note,
}: {
  label: string;
  count: number;
  totalEst: number;
  items: ContextItem[];
  view: 'category' | 'size';
  note?: string;
}) {
  const [open, setOpen] = useState(true);
  if (count === 0) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-bg-tertiary/30 transition-colors"
      >
        <span className={clsx('text-[10px] transition-transform', open ? 'rotate-90' : '')}>›</span>
        <span className="text-sm font-medium text-text-primary">{label}</span>
        <span className="text-xs text-text-muted">{count}</span>
        {note && <span className="text-[11px] text-text-disabled">({note})</span>}
        <span className="ml-auto text-xs text-text-muted font-mono">~{fmtNumber(totalEst)} tokens</span>
      </button>

      {open && (
        <div className="pb-1">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-3 px-8 py-1.5">
              <span className="text-xs text-accent font-mono shrink-0">{item.label}</span>
              <span className="text-xs text-text-muted truncate flex-1 italic">{item.preview}</span>
              <span className="text-xs text-text-muted font-mono shrink-0">~{fmtNumber(item.estTokens)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FlatContextItem({ item }: { item: ContextItem }) {
  const typeStyle =
    item.type === 'user'
      ? 'bg-accent/10 border-accent/30 text-accent'
      : 'bg-amber-500/10 border-amber-500/30 text-amber-400';

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span
        className={clsx(
          'shrink-0 text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded border',
          typeStyle,
        )}
      >
        {item.type === 'user' ? 'User' : 'Tool'}
      </span>
      <span className="text-xs text-text-muted font-mono shrink-0">{item.label}</span>
      <span className="text-xs text-text-muted truncate flex-1 italic">{item.preview}</span>
      <span className="text-xs text-text-muted font-mono shrink-0">{fmtNumber(item.estTokens)}</span>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function SessionTracePage() {
  const { id: rawId } = useParams<{ id: string }>();
  const sessionId = decodeURIComponent(rawId ?? '');
  const range: TimeRange = '30d';
  const { data, isLoading, error, refetch } = useObsSessionTrace(sessionId, range);
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set());
  const [showContext, setShowContext] = useState(false);
  const [selectedTurnIndex, setSelectedTurnIndex] = useState<number | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(false);

  const handleScroll = useCallback(() => {
    const scrollY = window.scrollY;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    setAtTop(scrollY < 100);
    setAtBottom(maxScroll - scrollY < 100);
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load session trace" retry={refetch} />;

  const totalTools = data.turns.reduce((s, t) => s + t.spans.filter((sp) => sp.kind === 'tool').length, 0);
  const totalHooks = data.turns.reduce((s, t) => s + t.spans.filter((sp) => sp.kind === 'hook').length, 0);
  const errorSpans = data.turns.reduce((s, t) => s + t.spans.filter((sp) => sp.isError).length, 0);
  const isSubagent = !!data.parentSessionId;

  const toggleTurn = (idx: number) => {
    setExpandedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const allExpanded = data.turns.length > 0 && expandedTurns.size === data.turns.length;
  const toggleAll = () => {
    if (allExpanded) setExpandedTurns(new Set());
    else setExpandedTurns(new Set(data.turns.map((t) => t.index)));
  };

  return (
    <div className="space-y-4">
      <div ref={topRef} />

      {/* Page header */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/observability/sessions"
          className="text-xl text-text-muted hover:text-text-primary transition-colors"
        >
          «
        </Link>
        <h1 className="text-xl font-semibold text-text-primary">
          Session <span className="font-mono text-accent">{sessionId.slice(0, 8)}</span>
        </h1>
        {data.project && (
          <span className="rounded-md bg-bg-tertiary px-2 py-0.5 text-xs text-text-muted">
            {data.project}
          </span>
        )}
        {/* Root / subagent indicator */}
        {isSubagent ? (
          <span className="rounded-md bg-purple-500/15 px-2 py-0.5 text-xs font-medium text-purple-400 border border-purple-500/30">
            subagent
          </span>
        ) : (
          <span className="rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent border border-accent/20">
            root
          </span>
        )}
        {data.parentSessionId && (
          <Link
            to={`/observability/sessions/${encodeURIComponent(data.parentSessionId)}`}
            className="text-xs text-accent hover:underline"
          >
            Parent →
          </Link>
        )}
        {data.gateInfo?.mode === 'inline' && (
          <span className="rounded-md bg-yellow-500/15 px-2 py-0.5 text-xs font-medium text-yellow-400 border border-yellow-500/30">
            inline
          </span>
        )}
        {data.gateInfo?.mode === 'dispatched' && (
          <span className="rounded-md bg-purple-500/15 px-2 py-0.5 text-xs font-medium text-purple-400 border border-purple-500/30">
            dispatched
          </span>
        )}
        {/* Controls */}
        <div className="ml-auto flex items-center gap-2">
          {!atTop && (
            <button
              onClick={() => topRef.current?.scrollIntoView({ behavior: 'smooth' })}
              className="text-xs text-text-muted hover:text-text-primary border border-border-primary bg-bg-secondary rounded px-2 py-1 transition-colors"
              title="Scroll to top"
            >
              ↑ Top
            </button>
          )}
          {!atBottom && (
            <button
              onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
              className="text-xs text-text-muted hover:text-text-primary border border-border-primary bg-bg-secondary rounded px-2 py-1 transition-colors"
              title="Scroll to bottom"
            >
              ↓ Bottom
            </button>
          )}
          <button
            onClick={toggleAll}
            className="text-xs text-text-muted hover:text-text-primary border border-border-primary bg-bg-secondary rounded px-2 py-1 transition-colors"
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
          <button
            onClick={() => { setShowContext(s => { if (s) setSelectedTurnIndex(null); return !s; }); }}
            className={clsx(
              'text-xs border rounded px-2 py-1 transition-colors',
              showContext
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border-primary bg-bg-secondary text-text-muted hover:text-text-primary',
            )}
          >
            Context
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard label="Duration" value={fmtDuration(data.totalDurationMs)} />
        <StatCard label="Turns" value={fmtNumber(data.turns.length)} />
        <StatCard label="Tool Calls" value={fmtNumber(totalTools)} />
        <StatCard label="Hook Runs" value={fmtNumber(totalHooks)} />
        <StatCard label="Tokens" value={fmtNumber(data.totalTokens)} />
        <StatCard
          label="Cost"
          value={fmtCurrency(data.totalCost)}
          {...(errorSpans > 0
            ? { detail: `${errorSpans} error${errorSpans !== 1 ? 's' : ''}`, accent: 'error' as const }
            : {})}
        />
      </div>

      {/* Turn feed + optional context sidebar */}
      <div className={clsx('flex gap-4 items-start', showContext && 'lg:gap-6')}>
        <div className="flex-1 min-w-0">
          {data.turns.length === 0 ? (
            <p className="py-12 text-center text-sm text-text-muted">No turns found for this session</p>
          ) : (
            <div className="space-y-3">
              {data.turns.map((turn, i) => {
                const prevTurn = i > 0 ? data.turns[i - 1] : undefined;
                return (
                  <div key={turn.index} className={clsx('space-y-1.5', selectedTurnIndex === turn.index && 'ring-1 ring-accent/30 rounded-sm')}>
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <UserBlock turn={turn} />
                      </div>
                      {showContext && (
                        <button
                          onClick={() => setSelectedTurnIndex(selectedTurnIndex === turn.index ? null : turn.index)}
                          className={clsx(
                            'shrink-0 mt-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors',
                            selectedTurnIndex === turn.index
                              ? 'border-accent/40 bg-accent/10 text-accent'
                              : 'border-border-primary bg-bg-secondary text-text-disabled hover:text-text-muted'
                          )}
                          title="Pin context to this turn"
                        >
                          ctx
                        </button>
                      )}
                    </div>
                    <ResponseBlock
                      turn={turn}
                      expanded={expandedTurns.has(turn.index)}
                      onToggle={() => toggleTurn(turn.index)}
                      sessionId={sessionId}
                      prevContextTokens={prevTurn?.contextTokens}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Context sidebar */}
        {showContext && data.turns.length > 0 && (
          <div className="w-80 shrink-0 sticky top-16">
            <ContextPanel turns={selectedTurnIndex !== null ? data.turns.slice(0, selectedTurnIndex + 1) as Turn[] : data.turns as Turn[]} />
          </div>
        )}
      </div>

      <div ref={bottomRef} />
      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
