import { Icon } from '../../../components/ui/Icon';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useObsSessionTrace, useObsSessionContextFiles } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { PageTitle, PageTitleLink, PageTitleSeparator } from '../../../components/layout/PageHeader';
import { type TimeRange } from '../../../components/data/TimeRangeSelector';
import { fmtNumber, fmtMs, fmtCurrency, dateTime, fmtDuration, fmtToolName, cleanMessage, formatModelName, fmtProject, modelContextWindow } from '../../../utils/format';
import { clsx } from 'clsx';

type TraceCompaction = {
  timestamp: string;
  trigger: string;
  preTokens?: number;
  postTokens?: number;
  summary?: string;
};

type Span = {
  id: string;
  kind: 'tool' | 'hook' | 'token' | 'verify';
  label: string;
  startMs: number;
  durationMs: number;
  isError?: boolean;
  detail?: string;
  subagentSessionId?: string;
  resultTokens?: number;
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
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  cost?: number;
  model?: string;
  assistantText?: string;
};

// ── Markdown renderer ──────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s<>"{}\\^`[\]|]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{renderInline(part.slice(2, -2))}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="font-mono bg-bg-tertiary px-1 rounded text-sm">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer"
          className="text-accent underline underline-offset-2 decoration-accent/40 hover:decoration-accent break-all transition-colors">
          {part}
        </a>
      );
    }
    return <span key={i}>{part.replace(/\*([^*]+)\*/g, '$1')}</span>;
  });
}

function MarkdownText({ text }: { text: string }) {
  type Block =
    | { kind: 'line'; text: string }
    | { kind: 'h1'; text: string }
    | { kind: 'h2'; text: string }
    | { kind: 'h3'; text: string }
    | { kind: 'ul'; items: string[] }
    | { kind: 'ol'; items: string[] }
    | { kind: 'code'; lang: string; content: string };

  const blocks: Block[] = [];
  let currentList: { kind: 'ul' | 'ol'; items: string[] } | null = null;

  // Pre-process: extract triple-backtick code blocks
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = /^```(\w*)/.exec(line);
    if (fenceMatch) {
      currentList = null;
      const lang = fenceMatch[1] || '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ kind: 'code', lang, content: codeLines.join('\n') });
      i++; // skip closing ```
      continue;
    }

    const h3Match = /^### (.+)$/.exec(line);
    const h2Match = /^## (.+)$/.exec(line);
    const h1Match = /^# (.+)$/.exec(line);
    const ulMatch = /^[-*] (.*)$/.exec(line);
    const olMatch = /^\d+\. (.*)$/.exec(line);

    if (h1Match) {
      currentList = null;
      blocks.push({ kind: 'h1', text: h1Match[1] });
    } else if (h2Match) {
      currentList = null;
      blocks.push({ kind: 'h2', text: h2Match[1] });
    } else if (h3Match) {
      currentList = null;
      blocks.push({ kind: 'h3', text: h3Match[1] });
    } else if (ulMatch) {
      if (currentList?.kind !== 'ul') {
        currentList = { kind: 'ul', items: [] };
        blocks.push(currentList);
      }
      currentList.items.push(ulMatch[1]);
    } else if (olMatch) {
      if (currentList?.kind !== 'ol') {
        currentList = { kind: 'ol', items: [] };
        blocks.push(currentList);
      }
      currentList.items.push(olMatch[1]);
    } else {
      currentList = null;
      blocks.push({ kind: 'line', text: line });
    }
    i++;
  }

  return (
    <>
      {blocks.map((block, idx) => {
        if (block.kind === 'h1') {
          return <h2 key={idx} className="text-base font-bold text-text-primary mt-3 mb-1">{renderInline(block.text)}</h2>;
        }
        if (block.kind === 'h2') {
          return <h3 key={idx} className="text-sm font-bold text-text-primary mt-2.5 mb-0.5">{renderInline(block.text)}</h3>;
        }
        if (block.kind === 'h3') {
          return <h4 key={idx} className="text-sm font-semibold text-text-secondary mt-2 mb-0.5">{renderInline(block.text)}</h4>;
        }
        if (block.kind === 'code') {
          return (
            <pre key={idx} className="font-mono bg-bg-tertiary px-3 py-2 rounded text-xs overflow-x-auto my-1 whitespace-pre-wrap break-all">
              {block.content}
            </pre>
          );
        }
        if (block.kind === 'ul') {
          return (
            <ul key={idx} className="list-disc list-inside my-1 space-y-0.5">
              {block.items.map((item, j) => (
                <li key={j} className="text-sm text-text-primary leading-relaxed">
                  {renderInline(item)}
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === 'ol') {
          return (
            <ol key={idx} className="list-decimal list-inside my-1 space-y-0.5">
              {block.items.map((item, j) => (
                <li key={j} className="text-sm text-text-primary leading-relaxed">
                  {renderInline(item)}
                </li>
              ))}
            </ol>
          );
        }
        if (block.text === '') {
          return <br key={idx} />;
        }
        return (
          <p key={idx} className="text-sm text-text-primary leading-relaxed">
            {renderInline(block.text)}
          </p>
        );
      })}
    </>
  );
}

// ── Span row inside expanded response ─────────────────────────────────────────

function parseHookDecision(detail?: string): 'block' | 'advisory' | 'pass' | null {
  if (!detail) return null;
  const m = detail.match(/decision[=:]\s*(block|advisory|pass)/i);
  return m ? (m[1].toLowerCase() as 'block' | 'advisory' | 'pass') : null;
}

function SpanRow({ span, sessionId }: { span: Span; sessionId: string }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!span.detail || !!span.subagentSessionId;
  const isSubagent = span.kind === 'tool' && span.label === 'Agent';

  const hookDecision = span.kind === 'hook' ? parseHookDecision(span.detail) : null;

  const kindStyle =
    span.isError
      ? 'bg-error/10 border-error/30 text-error'
      : span.kind === 'hook' && hookDecision === 'block'
      ? 'bg-error/10 border-error/30 text-error'
      : span.kind === 'hook' && hookDecision === 'advisory'
      ? 'bg-warning/10 border-warning/30 text-warning'
      : span.kind === 'hook' && hookDecision === 'pass'
      ? 'bg-success/10 border-success/30 text-success'
      : span.kind === 'hook'
      ? 'bg-purple-500/10 border-purple-500/30 text-purple-400'
      : span.kind === 'verify'
      ? (span.label.includes('FAIL') ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-green-500/10 border-green-500/30 text-green-400')
      : isSubagent
      ? 'bg-agent/20 border-agent-border text-text-primary'
      : 'bg-accent/10 border-accent/30 text-accent';

  return (
    <>
      <div
        className={clsx(
          'grid items-center gap-x-3 px-3 py-1.5 border-b border-border-primary/20 last:border-b-0 text-xs',
          'grid-cols-[4rem_9rem_1fr_auto]',
          hasDetail && 'cursor-pointer hover:bg-bg-tertiary/30',
        )}
        style={{ gridTemplateColumns: '4.5rem 9rem 1fr auto' }}
        onClick={() => hasDetail && setOpen(!open)}
      >
        {/* Kind badge — fixed width column */}
        <span
          className={clsx(
            'inline-flex items-center justify-center px-1.5 py-0.5 rounded border text-xs font-semibold uppercase tracking-wide w-fit',
            kindStyle,
          )}
        >
          {isSubagent ? 'agent' : span.kind === 'verify' ? (span.label.includes('FAIL') ? 'fail' : 'pass') : hookDecision ?? span.kind}
        </span>

        {/* Name — fixed width column, mono, truncated */}
        <span className={clsx('font-mono truncate font-medium',
          span.isError ? 'text-error'
          : span.kind === 'hook' && hookDecision === 'block' ? 'text-error'
          : span.kind === 'hook' && hookDecision === 'advisory' ? 'text-warning'
          : span.kind === 'hook' && hookDecision === 'pass' ? 'text-success'
          : span.kind === 'hook' ? 'text-purple-300'
          : span.kind === 'verify' ? (span.label.includes('FAIL') ? 'text-red-400' : 'text-green-400')
          : isSubagent ? 'text-text-primary' : 'text-sky-500')}>
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

        {/* Inline detail preview — flex-1 */}
        <span className="text-text-muted truncate min-w-0">
          {span.detail && !open
            ? span.detail.replace(/^(command|description|file_path|content|pattern|query|url|path|prompt|message):\s*/gmi, '').slice(0, 80)
            : ''}
        </span>

        {/* Right side: status dot + duration + expand caret */}
        <div className="flex items-center gap-2 justify-end">
          <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', span.isError ? 'bg-error' : 'bg-green-500')} />
          {span.durationMs > 0 && (
            <span className="text-emerald-400/70 font-mono">{fmtMs(span.durationMs)}</span>
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

// ── Token delta hover breakdown ────────────────────────────────────────────────

function TokenDeltaHover({
  delta, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
}: {
  delta: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}) {
  const [show, setShow] = useState(false);
  const hasBreakdown = !!(inputTokens || outputTokens || cacheReadTokens || cacheCreationTokens);

  return (
    <span className="relative inline-flex items-center">
      <span
        className="text-text-secondary cursor-default"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        {' '}(+{fmtNumber(delta)})
      </span>
      {show && hasBreakdown && (
        <span className="absolute bottom-full left-0 mb-1.5 z-50 min-w-[170px] rounded border border-border-primary bg-bg-primary shadow-lg px-3 py-2 text-[11px] space-y-1 pointer-events-none">
          {cacheReadTokens !== undefined && cacheReadTokens > 0 && (
            <span className="flex justify-between gap-4">
              <span className="text-text-secondary">Cache read</span>
              <span className="text-text-secondary font-mono">{fmtNumber(cacheReadTokens)}</span>
            </span>
          )}
          {cacheCreationTokens !== undefined && cacheCreationTokens > 0 && (
            <span className="flex justify-between gap-4">
              <span className="text-text-secondary">Cache write</span>
              <span className="text-text-secondary font-mono">{fmtNumber(cacheCreationTokens)}</span>
            </span>
          )}
          {inputTokens !== undefined && inputTokens > 0 && (
            <span className="flex justify-between gap-4">
              <span className="text-text-secondary">Fresh input</span>
              <span className="text-text-secondary font-mono">{fmtNumber(inputTokens)}</span>
            </span>
          )}
          {outputTokens !== undefined && outputTokens > 0 && (
            <span className="flex justify-between gap-4">
              <span className="text-text-secondary">Output</span>
              <span className="text-text-secondary font-mono">{fmtNumber(outputTokens)}</span>
            </span>
          )}
        </span>
      )}
    </span>
  );
}

// ── Compaction divider ─────────────────────────────────────────────────────────

function CompactionDivider({ compaction }: { compaction: TraceCompaction }) {
  const [open, setOpen] = useState(false);
  const freed = compaction.preTokens && compaction.postTokens
    ? compaction.preTokens - compaction.postTokens
    : undefined;
  const pct = freed && compaction.preTokens ? Math.round(freed / compaction.preTokens * 100) : undefined;

  return (
    <div className="flex flex-col items-center my-2 gap-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-purple-500/30 bg-purple-500/5 text-xs text-purple-400 hover:bg-purple-500/10 transition-colors"
      >
        <span className={clsx('transition-transform text-xs', open ? 'rotate-90' : '')}>›</span>
        <span>⟳ Context compacted</span>
        {compaction.preTokens && (
          <span className="text-purple-400/60">
            {fmtNumber(compaction.preTokens)} tokens
            {freed !== undefined && pct !== undefined && (
              <> → {fmtNumber(compaction.preTokens - freed)} ({pct}% freed)</>
            )}
          </span>
        )}
        <span className="text-purple-400/40 text-xs">{compaction.trigger}</span>
      </button>
      {open && (
        <div className="w-full max-w-2xl mt-1 rounded border border-purple-500/20 bg-purple-500/5 px-4 py-3 text-xs text-text-muted">
          {compaction.summary ? (
            <pre className="whitespace-pre-wrap break-words font-mono">{compaction.summary}</pre>
          ) : (
            <span className="text-text-disabled italic">Compaction document not available</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Response block (collapsed/expanded) ───────────────────────────────────────

function ResponseBlock({
  turn,
  expanded,
  onToggle,
  sessionId,
  runningCost,
  prevContextTokens,
  onContextClick,
}: {
  turn: Turn;
  expanded: boolean;
  onToggle: () => void;
  sessionId: string;
  runningCost?: number;
  prevContextTokens?: number;
  onContextClick?: () => void;
}) {
  const subagentSpans = turn.spans.filter((s) => s.kind === 'tool' && s.label === 'Agent');
  const skillSpans = turn.spans.filter((s) => s.kind === 'tool' && s.label.startsWith('Skill('));
  const toolSpans = turn.spans.filter((s) => s.kind === 'tool' && s.label !== 'Agent' && !s.label.startsWith('Skill('));
  const hookSpans = turn.spans.filter((s) => s.kind === 'hook');

  const summaryParts: string[] = [];
  if (toolSpans.length > 0) summaryParts.push(`${toolSpans.length} tool${toolSpans.length !== 1 ? 's' : ''}`);
  if (hookSpans.length > 0) summaryParts.push(`${hookSpans.length} hook${hookSpans.length !== 1 ? 's' : ''}`);
  if (skillSpans.length > 0) summaryParts.push(`${skillSpans.length} skill${skillSpans.length !== 1 ? 's' : ''}`);
  if (subagentSpans.length > 0) summaryParts.push(`${subagentSpans.length} subagent${subagentSpans.length !== 1 ? 's' : ''}`);

  const errorCount = turn.spans.filter((s) => s.isError).length;
  const hasSpans = turn.spans.length > 0;

  const modelLabel = turn.model ? formatModelName(turn.model) : 'Claude';

  // Context delta (tokens added since previous turn)
  const ctxDelta = turn.contextTokens && prevContextTokens ? turn.contextTokens - prevContextTokens : undefined;

  return (
    <div className="ml-2 space-y-1">
      {/* Constrain label + bubble to same max-width so stats align to bubble edge */}
      <div className="max-w-[85%]">
        {/* Label row — model name + summary + caret left, stats right */}
        <div className="flex items-center gap-1.5 px-1 flex-wrap">
          <span className="font-mono text-xs text-accent tracking-wider uppercase shrink-0 leading-none">Claude</span>
          {turn.model && <span className="text-xs text-sky-400 font-mono shrink-0 leading-none">{modelLabel}</span>}
          <span className="font-mono text-xs font-bold text-violet-400 shrink-0 leading-none">#{turn.index + 1}</span>
          {summaryParts.length > 0 && (
            <>
              <span className="text-text-muted/60 text-xs leading-none shrink-0">•</span>
              <span className="text-sm text-text-secondary shrink-0 leading-none">{summaryParts.join(', ')}</span>
            </>
          )}
          {errorCount > 0 && (
            <>
              <span className="text-text-muted/60 text-xs leading-none shrink-0">•</span>
              <span className="text-xs text-error shrink-0 leading-none">{errorCount} error{errorCount !== 1 ? 's' : ''}</span>
            </>
          )}
          {hasSpans && (
            <button
              onClick={onToggle}
              className="shrink-0 flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-secondary hover:bg-bg-tertiary transition-colors"
              title={expanded ? 'Collapse' : 'Expand'}
            >
              <Icon name="expand_more" size="xs" className={clsx('transition-transform duration-150', expanded ? 'rotate-180' : '')} />
            </button>
          )}
          {/* Stats on the right */}
          <div className="ml-auto flex items-center gap-1 shrink-0 flex-wrap justify-end">
            <div className="flex items-center gap-1 text-xs font-mono">
              {(runningCost !== undefined && runningCost > 0) || turn.cost ? (
                <span className="text-text-secondary">
                  {runningCost !== undefined && runningCost > 0 ? fmtCurrency(runningCost) : ''}
                  {turn.cost && turn.cost > 0 ? ` (+${fmtCurrency(turn.cost)})` : ''}
                </span>
              ) : null}
              {turn.contextTokens ? (
                <>
                  <span className="text-text-muted/60 text-xs leading-none">•</span>
                  {onContextClick ? (
                    <button
                      onClick={onContextClick}
                      className="text-sky-400/80 hover:text-sky-400 underline underline-offset-2 decoration-sky-400/40 hover:decoration-sky-400 transition-colors"
                      title="Show context at this turn"
                    >
                      {fmtNumber(turn.contextTokens)}
                    </button>
                  ) : (
                    <span className="text-sky-400/80">{fmtNumber(turn.contextTokens)}</span>
                  )}
                  {ctxDelta !== undefined && ctxDelta > 0 && (
                    <TokenDeltaHover
                      delta={ctxDelta}
                      inputTokens={turn.inputTokens}
                      outputTokens={turn.outputTokens}
                      cacheReadTokens={turn.cacheReadTokens}
                      cacheCreationTokens={turn.cacheCreationTokens}
                    />
                  )}
                </>
              ) : null}
              {turn.durationMs > 0 && (
                <>
                  <span className="text-text-muted/60 text-xs leading-none">•</span>
                  <span className="text-text-secondary">{fmtDuration(turn.durationMs)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Bubble */}
        <div className="bg-bg-secondary border-l-4 border-border-primary rounded-sm px-4 py-3 space-y-2">
          {/* Expanded spans panel — above the text */}
          {hasSpans && expanded && (
            <div className="rounded-sm border border-border-primary bg-bg-primary overflow-hidden">
              {turn.spans.map((span, i) => (
                <SpanRow key={`${span.id}-${i}`} span={span} sessionId={sessionId} />
              ))}
            </div>
          )}

          {/* Assistant text */}
          {turn.assistantText ? (
            <div className="break-words">
              <MarkdownText text={turn.assistantText} />
            </div>
          ) : !hasSpans && (
            <span className="text-sm text-text-disabled italic">—</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── User message block ─────────────────────────────────────────────────────────

// Claude Code built-in slash commands — never link these to skill detail pages
const CLAUDE_BUILTIN_COMMANDS = new Set([
  'add-dir', 'allowed-tools', 'bug', 'clear', 'compact', 'config', 'cost',
  'doctor', 'help', 'history', 'init', 'login', 'logout', 'mcp', 'memory',
  'model', 'permissions', 'pr_comments', 'release-notes', 'review', 'status',
  'terminal-setup', 'vim',
]);

const INTERRUPT_PATTERNS = [
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]',
];

function isInterrupt(msg: string): boolean {
  return INTERRUPT_PATTERNS.some((p) => msg.includes(p));
}

function parseCommandInvocation(raw: string): { name: string; args: string } | null {
  const nameMatch = raw.match(/<command-name>([^<]+)<\/command-name>/);
  if (!nameMatch) return null;
  const argsMatch = raw.match(/<command-args>([^<]*)<\/command-args>/);
  const name = nameMatch[1].trim();
  const rawArgs = (argsMatch?.[1] ?? '').trim();
  // Deduplicate: skip args if they're just the command name with/without leading slash
  const bare = name.replace(/^\//, '');
  const isDuplicate = rawArgs === name || rawArgs === `/${bare}` || rawArgs === bare;
  return { name, args: isDuplicate ? '' : rawArgs };
}

function stripMarkdownForPreview(text: string): string {
  // Must operate on multiline text (before whitespace collapsing) for ^ anchors to work
  return text
    .replace(/```[\s\S]*?```/gm, '')   // ``` code blocks ```
    .replace(/^#{1,6}\s+/gm, '')       // ## headings
    .replace(/\*\*([^*]+)\*\*/g, '$1') // **bold**
    .replace(/\*([^*]+)\*/g, '$1')     // *italic*
    .replace(/`([^`]+)`/g, '$1')       // `inline code`
    .replace(/^>\s+/gm, '')            // > blockquote
    .replace(/^[-*]\s+/gm, '')         // - list items
    .replace(/^\|.*$/gm, '')           // | table rows |
    .replace(/\s+/g, ' ')
    .trim();
}

function commandPreview(raw: string): string {
  const cmd = parseCommandInvocation(raw);
  if (!cmd) return '';
  return cmd.args ? `${cmd.name} ${cmd.args}` : cmd.name;
}

function decodeHtmlEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function parseTaskNotification(raw: string): { taskId: string; status: string; summary: string } | null {
  if (!raw.includes('<task-notification>')) return null;
  const taskId = raw.match(/<task-id>([^<]+)<\/task-id>/)?.[1] ?? '';
  const status = raw.match(/<status>([^<]+)<\/status>/)?.[1] ?? '';
  const summary = decodeHtmlEntities(raw.match(/<summary>([^<]*)<\/summary>/)?.[1] ?? '');
  return { taskId, status, summary };
}

function UserBlock({ turn, sessionId, prevTurn }: {
  turn: Turn;
  sessionId: string;
  prevTurn?: Turn;
}) {
  const time = dateTime(turn.startTime);
  const isCaveat = turn.userMessage.includes('local-command-caveat');
  const isStdout = turn.userMessage.includes('local-command-stdout');
  const interrupt = isInterrupt(turn.userMessage);

  if (isCaveat) {
    return null;
  }

  // Skip session-lifecycle commands that appear as the first message due to /clear starting a new session
  const SESSION_LIFECYCLE = new Set(['clear', 'reset']);
  const cmdName = turn.userMessage.match(/<command-name>\/?([^<]+)<\/command-name>/)?.[1]?.trim().toLowerCase();
  if (cmdName && SESSION_LIFECYCLE.has(cmdName) && turn.index === 0) {
    return null;
  }

  // Task notification (background task result)
  const taskNotif = parseTaskNotification(turn.userMessage);
  if (taskNotif) {
    const isFailure = taskNotif.status === 'failed' || taskNotif.status === 'error';
    return (
      <div className="flex justify-center my-1">
        <div className={clsx(
          'flex items-center gap-2 px-3 py-1.5 rounded border text-xs',
          isFailure
            ? 'border-error/30 bg-error/5 text-error'
            : 'border-border-primary/40 bg-bg-tertiary/40 text-text-muted'
        )}>
          <Icon name={isFailure ? 'close' : 'check'} size="xs" />
          <span className="font-mono text-xs text-text-disabled">{taskNotif.taskId.slice(0, 8)}</span>
          <span>{taskNotif.summary || `Task ${taskNotif.status}`}</span>
          <span className="text-text-disabled text-xs">{time}</span>
        </div>
      </div>
    );
  }

  // Skill body: the turn immediately after a command invocation contains the skill's text.
  // Hide it — the skill link from the previous turn provides navigation.
  const looksLikeSkillBody = (msg: string) => {
    const s = msg.trimStart();
    return s.startsWith('#') || /^\d+\.\s/.test(s) || /^[-*]\s/.test(s);
  };
  const isSkillBody = !turn.userMessage.includes('<command-name>') &&
    !turn.userMessage.includes('<local-command-') &&
    !!prevTurn && parseCommandInvocation(prevTurn.userMessage) !== null &&
    looksLikeSkillBody(turn.userMessage);
  if (isSkillBody) {
    return null;
  }

  if (interrupt) {
    return (
      <div className="flex justify-center my-1">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded border border-warning/30 bg-warning/5 text-xs text-warning">
          <span>⚠</span>
          <span>Request interrupted by user</span>
          <span className="text-text-disabled text-xs">{time}</span>
        </div>
      </div>
    );
  }

  if (isStdout) {
    const stdoutContent = turn.userMessage.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/)?.[1]?.trim()
      || cleanMessage(turn.userMessage);
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[85%] rounded-sm border border-border-primary/40 bg-bg-primary overflow-hidden">
          <div className="px-2 py-1 border-b border-border-primary/30 bg-bg-tertiary/40">
            <span className="text-xs text-text-disabled font-mono tracking-wider uppercase">shell output</span>
          </div>
          <pre className="px-3 py-2 text-xs font-mono text-text-secondary whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-y-auto">
            {stdoutContent || '(no output)'}
          </pre>
        </div>
      </div>
    );
  }

  // Skill/command invocation — render as a compact pill (linked if user-defined, plain if built-in)
  const cmd = parseCommandInvocation(turn.userMessage);
  if (cmd) {
    const skillName = cmd.name.startsWith('/') ? cmd.name.slice(1) : cmd.name;
    const isBuiltin = CLAUDE_BUILTIN_COMMANDS.has(skillName.toLowerCase());
    return (
      <div className="flex justify-end my-0.5">
        {isBuiltin ? (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border-primary bg-bg-secondary text-xs font-mono">
            <span className="text-text-muted">{cmd.name}</span>
            {cmd.args && <span className="text-text-disabled">{cmd.args}</span>}
          </span>
        ) : (
          <Link
            to={`/observability/skills/${encodeURIComponent(skillName)}?session=${encodeURIComponent(sessionId)}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-accent/30 bg-accent/5 text-xs hover:bg-accent/10 transition-colors font-mono"
          >
            <span className="text-accent">{cmd.name}</span>
            {cmd.args && <span className="text-text-muted">{cmd.args}</span>}
            <Icon name="open_in_new" size="xs" className="text-text-disabled" />
          </Link>
        )}
      </div>
    );
  }

  const msg = cleanMessage(turn.userMessage);

  return (
    <div className="flex flex-col items-end gap-1">
      {/* Label row */}
      <div className="flex items-center gap-1.5 px-1">
        <span className="font-mono text-xs font-bold text-violet-400 leading-none shrink-0">#{turn.index + 1}</span>
        <span className="text-xs text-text-secondary font-mono leading-none">{time}</span>
        <span className="text-text-muted/60 text-xs leading-none">•</span>
        <span className="font-mono text-xs text-accent tracking-wider uppercase leading-none">You</span>
      </div>
      {/* Message bubble */}
      <div className="max-w-[75%] bg-bg-secondary border-l-4 border-accent rounded-sm px-4 py-3">
        {msg ? (
          <div className="text-sm text-text-primary leading-relaxed">
            <MarkdownText text={msg} />
          </div>
        ) : (
          <span className="text-sm text-text-disabled">—</span>
        )}
      </div>
    </div>
  );
}

// ── System context breakdown ───────────────────────────────────────────────────

function SystemContextBreakdown({
  systemEst,
  totalContextTokens,
  maxContextTokens,
  contextFiles,
  firstTurnCacheRead,
}: {
  systemEst: number;
  totalContextTokens: number;
  maxContextTokens: number;
  contextFiles?: ContextFile[];
  firstTurnCacheRead?: number;
}) {
  const [open, setOpen] = useState(false);
  const knownFileTokens = contextFiles?.reduce((s, f) => s + f.estTokens, 0) ?? 0;

  // Prefer direct measurement (turn-0 cacheRead) over top-down remainder estimate.
  // At session start, cacheRead = exactly what's cached before any conversation = system prompt.
  const measured = firstTurnCacheRead != null && firstTurnCacheRead > knownFileTokens;
  const displayTotal = measured ? firstTurnCacheRead! : systemEst;
  const baseOverhead = measured
    ? Math.max(0, firstTurnCacheRead! - knownFileTokens)
    : Math.max(0, systemEst - knownFileTokens);
  const pctUsed = totalContextTokens > 0 ? Math.round(displayTotal / totalContextTokens * 100) : 0;
  const pctMax = maxContextTokens > 0 ? Math.round(displayTotal / maxContextTokens * 100) : 0;

  return (
    <div className="border-t border-border-primary/40">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-bg-tertiary/30 transition-colors"
      >
        <span className="text-xs text-text-muted flex items-center gap-1.5">
          <Icon name="expand_more" size="xs" className={clsx('shrink-0 transition-transform duration-150', open ? 'rotate-180' : '')} />
          System / CLAUDE.md / settings
        </span>
        <span className="text-xs text-text-muted font-mono">{fmtNumber(displayTotal)} ({pctUsed}% · {pctMax}% max)</span>
      </button>
      {open && (
        <div className="px-4 pb-2.5 space-y-1">
          {contextFiles && contextFiles.length > 0 && contextFiles.map((f, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-text-muted truncate flex-1" title={f.path}>{f.label}</span>
              <span className="text-[11px] text-text-disabled font-mono shrink-0">{fmtNumber(f.estTokens)}</span>
            </div>
          ))}
          {baseOverhead > 100 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-text-disabled truncate flex-1">
                Base system prompt + tool defs{measured ? '' : ' (est)'}
              </span>
              <span className="text-[11px] text-text-disabled font-mono shrink-0">
                {measured ? '' : '~'}{fmtNumber(baseOverhead)}
              </span>
            </div>
          )}
          {!contextFiles?.length && !measured && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-text-disabled">Base system prompt + tool defs (est)</span>
              <span className="text-[11px] text-text-disabled font-mono">~{fmtNumber(displayTotal)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Context panel ──────────────────────────────────────────────────────────────

type ContextItem = {
  type: 'user' | 'tool' | 'assistant';
  turnIndex: number;
  label: string;
  preview?: string;
  estTokens: number;
};

type ContextFile = { label: string; path: string; chars: number; estTokens: number };

function ContextPanel({ turns, contextFiles, onTurnClick }: {
  turns: Turn[];
  contextFiles?: ContextFile[];
  onTurnClick?: (index: number) => void;
}) {
  const [view, setView] = useState<'category' | 'size'>('category');

  const lastTurn = turns[turns.length - 1];
  const totalContextTokens = lastTurn?.contextTokens;
  const maxContextTokens = modelContextWindow(lastTurn?.model);

  // Build items from what we have
  const userItems: ContextItem[] = turns
    .filter((t) => cleanMessage(t.userMessage).length > 0)
    .map((t) => {
      const raw = t.userMessage;
      // For command invocations use the clean name; for regular messages strip markdown.
      // Strip XML tags while preserving newlines so multiline regex anchors work in stripMarkdownForPreview.
      const preview = raw.includes('<command-name>')
        ? commandPreview(raw)
        : stripMarkdownForPreview(raw.replace(/<[^>]+>/g, '')).slice(0, 70);
      const text = cleanMessage(raw);
      return {
        type: 'user',
        turnIndex: t.index,
        label: `@${t.index + 1}`,
        preview,
        estTokens: Math.ceil(text.length / 4),
      };
    });

  const toolItems: ContextItem[] = turns
    .filter((t) => t.spans.some((s) => s.kind === 'tool'))
    .map((t) => {
      const toolSpans = t.spans.filter((s) => s.kind === 'tool');
      const estTokens = toolSpans.reduce((sum, s) => {
        // Use actual result token count if available, otherwise estimate from param detail
        return sum + (s.resultTokens ?? Math.ceil((s.detail || '').length / 4));
      }, 0);
      return {
        type: 'tool',
        turnIndex: t.index,
        label: `@${t.index + 1}`,
        preview: `${toolSpans.length} tool${toolSpans.length !== 1 ? 's' : ''}`,
        estTokens,
      };
    });

  // Assistant responses — each turn's outputTokens sits in context for all subsequent turns
  // We include turns that have output (skip the last turn; its response isn't yet in context)
  const assistantItems: ContextItem[] = turns
    .filter((t) => (t.outputTokens ?? 0) > 0)
    .map((t) => ({
      type: 'assistant' as const,
      turnIndex: t.index,
      label: `@${t.index + 1}`,
      preview: t.assistantText ? t.assistantText.slice(0, 70) : `${t.outputTokens} tokens`,
      estTokens: t.outputTokens!,
    }));

  const totalUserEst = userItems.reduce((s, i) => s + i.estTokens, 0);
  const totalToolEst = toolItems.reduce((s, i) => s + i.estTokens, 0);
  const totalAssistantEst = assistantItems.reduce((s, i) => s + i.estTokens, 0);

  // System / CLAUDE.md / settings = remainder after accounting for messages, tools, and assistant
  const systemEst = totalContextTokens
    ? Math.max(0, totalContextTokens - totalUserEst - totalToolEst - totalAssistantEst)
    : 0;

  // Use turn-0 cacheRead as a direct measurement of the base system overhead.
  // At session start, nothing from conversation is cached yet, so cacheRead = system prompt only.
  const firstTurnCacheRead = turns.find(t => (t.cacheReadTokens ?? 0) > 0)?.cacheReadTokens;

  // Flat sorted view
  const flatItems = [...userItems, ...toolItems, ...assistantItems].sort((a, b) =>
    view === 'size' ? b.estTokens - a.estTokens : a.turnIndex - b.turnIndex,
  );

  const sortedUserItems =
    view === 'size' ? [...userItems].sort((a, b) => b.estTokens - a.estTokens) : userItems;
  const sortedToolItems =
    view === 'size' ? [...toolItems].sort((a, b) => b.estTokens - a.estTokens) : toolItems;
  const sortedAssistantItems =
    view === 'size' ? [...assistantItems].sort((a, b) => b.estTokens - a.estTokens) : assistantItems;

  return (
    <div className="rounded-sm border border-border-primary bg-bg-secondary overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-baseline gap-2 px-4 py-3 border-b border-border-primary">
        <span className="text-sm font-medium text-text-secondary leading-none">Context</span>
        {totalContextTokens ? (
          <span className="text-xs text-text-muted leading-none">
            {fmtNumber(totalContextTokens)} / {fmtNumber(maxContextTokens)} tokens ({Math.round(totalContextTokens / maxContextTokens * 100)}% of max)
          </span>
        ) : (
          <span className="text-xs text-text-disabled leading-none">token data unavailable</span>
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

      </div>

      {/* Body */}
      <div className="divide-y divide-border-primary/20">
        {view === 'category' ? (
          <>
            {/* User Messages group */}
            <ContextGroup
              label="User Messages"
              count={userItems.length}
              totalEst={totalUserEst}
              totalContextTokens={totalContextTokens}
              maxContextTokens={maxContextTokens}
              items={sortedUserItems}
              view={view}
              onTurnClick={onTurnClick}
            />

            {/* Tool Outputs group */}
            <ContextGroup
              label="Tool Calls"
              count={toolItems.length}
              totalEst={totalToolEst}
              totalContextTokens={totalContextTokens}
              maxContextTokens={maxContextTokens}
              items={sortedToolItems}
              view={view}
              onTurnClick={onTurnClick}
            />

            {/* Assistant responses */}
            <ContextGroup
              label="Assistant Responses"
              count={assistantItems.length}
              totalEst={totalAssistantEst}
              totalContextTokens={totalContextTokens}
              maxContextTokens={maxContextTokens}
              items={sortedAssistantItems}
              view={view}
              onTurnClick={onTurnClick}
            />
          </>
        ) : (
          /* Flat view — single list sorted by size */
          <div className="px-4 py-2 space-y-0">
            {flatItems.map((item, i) => (
              <FlatContextItem key={i} item={item} onTurnClick={onTurnClick} />
            ))}
          </div>
        )}
      </div>

      {/* System / CLAUDE.md / settings breakdown */}
      {systemEst > 0 && totalContextTokens && (
        <SystemContextBreakdown
          systemEst={systemEst}
          totalContextTokens={totalContextTokens}
          maxContextTokens={maxContextTokens}
          contextFiles={contextFiles}
          firstTurnCacheRead={firstTurnCacheRead}
        />
      )}

      <div className="px-4 py-1.5 border-t border-border-primary text-[11px] text-text-disabled">
        Sizes estimated from result tokens and message length.
      </div>
    </div>
  );
}

function ContextGroup({
  label,
  count,
  totalEst,
  totalContextTokens,
  maxContextTokens,
  items,
  view,
  onTurnClick,
}: {
  label: string;
  count: number;
  totalEst: number;
  totalContextTokens?: number;
  maxContextTokens?: number;
  items: ContextItem[];
  view: 'category' | 'size';
  onTurnClick?: (index: number) => void;
}) {
  const [open, setOpen] = useState(true);
  if (count === 0) return null;

  const pctUsed = totalContextTokens ? Math.round(totalEst / totalContextTokens * 100) : 0;
  const pctMax = maxContextTokens ? Math.round(totalEst / maxContextTokens * 100) : 0;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-baseline gap-2 px-4 py-2.5 hover:bg-bg-tertiary/30 transition-colors"
      >
        <Icon name="expand_more" size="xs" className={clsx('shrink-0 self-center transition-transform duration-150', open ? 'rotate-180' : '')} />
        <span className="text-sm font-medium text-text-primary shrink-0 whitespace-nowrap leading-none">{label}</span>
        <span className="text-xs text-text-muted shrink-0 leading-none">{count}</span>
        <span className="ml-auto text-xs text-text-muted font-mono shrink-0 whitespace-nowrap leading-none">
          {fmtNumber(totalEst)}{totalContextTokens ? ` (${pctUsed}% · ${pctMax}% max)` : ''}
        </span>
      </button>

      {open && (
        <div className="pb-1">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-3 px-8 py-1.5">
              {onTurnClick ? (
                <button
                  className="text-xs text-accent font-mono shrink-0 hover:underline"
                  onClick={() => onTurnClick(item.turnIndex)}
                >
                  {item.label}
                </button>
              ) : (
                <span className="text-xs text-accent font-mono shrink-0">{item.label}</span>
              )}
              <span className="text-xs text-text-muted truncate flex-1">{item.preview}</span>
              <span className="text-xs text-text-muted font-mono shrink-0">{fmtNumber(item.estTokens)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FlatContextItem({ item, onTurnClick }: { item: ContextItem; onTurnClick?: (index: number) => void }) {
  const typeStyle =
    item.type === 'user'
      ? 'bg-accent/10 border-accent/30 text-accent'
      : item.type === 'assistant'
      ? 'bg-green-500/10 border-green-500/30 text-green-400'
      : 'bg-amber-500/10 border-amber-500/30 text-amber-400';

  const typeLabel = item.type === 'user' ? 'User' : item.type === 'assistant' ? 'Asst' : 'Tool';

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span
        className={clsx(
          'shrink-0 text-xs uppercase font-semibold px-1.5 py-0.5 rounded border',
          typeStyle,
        )}
      >
        {typeLabel}
      </span>
      {onTurnClick ? (
        <button
          className="text-xs text-accent font-mono shrink-0 hover:underline"
          onClick={() => onTurnClick(item.turnIndex)}
        >
          {item.label}
        </button>
      ) : (
        <span className="text-xs text-text-muted font-mono shrink-0">{item.label}</span>
      )}
      <span className="text-xs text-text-muted truncate flex-1">{item.preview}</span>
      <span className="text-xs text-text-muted font-mono shrink-0">{fmtNumber(item.estTokens)}</span>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function SessionTracePage() {
  const { id: rawId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const targetTimestamp = searchParams.get('t');
  const sessionId = decodeURIComponent(rawId ?? '');
  const range: TimeRange = '30d';
  const { data, isLoading, error, refetch } = useObsSessionTrace(sessionId, range);
  const { data: contextFilesData } = useObsSessionContextFiles(sessionId);
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set());
  const [showContext, setShowContext] = useState(true);
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

  // Scroll to and highlight the turn closest to the target timestamp (from skill detail link)
  useEffect(() => {
    if (!data || !targetTimestamp) return;
    const target = new Date(targetTimestamp).getTime();
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (const turn of data.turns) {
      const delta = Math.abs(new Date(turn.startTime).getTime() - target);
      if (delta < bestDelta) { bestDelta = delta; bestIdx = turn.index; }
    }
    if (bestIdx >= 0) {
      setSelectedTurnIndex(bestIdx);
      setExpandedTurns(prev => new Set([...prev, bestIdx]));
      setTimeout(() => {
        const el = document.getElementById(`turn-${bestIdx}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, [data, targetTimestamp]);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load session trace" retry={refetch} />;

  const totalTools = data.turns.reduce((s, t) => s + t.spans.filter((sp) => sp.kind === 'tool').length, 0);
  const totalHooks = data.turns.reduce((s, t) => s + t.spans.filter((sp) => sp.kind === 'hook').length, 0);
  const toolErrors = data.turns.reduce((s, t) => s + t.spans.filter((sp) => sp.kind === 'tool' && sp.isError).length, 0);
  const hookErrors = data.turns.reduce((s, t) => s + t.spans.filter((sp) => sp.kind === 'hook' && sp.isError).length, 0);
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

  // Compute cumulative cost per turn
  const cumulativeCosts: number[] = [];
  let runningSum = 0;
  for (const turn of data.turns) {
    runningSum += turn.cost ?? 0;
    cumulativeCosts.push(runningSum);
  }

  const compactions: TraceCompaction[] = data.compactions ?? [];

  const handleTurnClick = (turnIndex: number) => {
    setSelectedTurnIndex(turnIndex);
    const el = document.getElementById(`turn-${turnIndex}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="space-y-4">
      <div ref={topRef} />

      {/* Page header */}
      <div className="sticky top-0 z-10 h-14 bg-bg-primary border-b border-border-primary flex flex-wrap items-center gap-2">
        <PageTitleLink to="/observability/sessions">Sessions</PageTitleLink>
        <PageTitleSeparator />
        <PageTitle><span className="font-mono text-accent">{sessionId.slice(0, 8)}</span></PageTitle>
        {data.project && (
          <span className="rounded-md bg-bg-tertiary px-2 py-0.5 text-xs text-text-muted font-mono">
            {fmtProject(data.project)}
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
        <StatCard
          label="Tool Calls"
          value={fmtNumber(totalTools)}
          {...(toolErrors > 0
            ? { detail: `${toolErrors} err`, accent: 'error' as const }
            : {})}
        />
        <StatCard
          label="Hook Runs"
          value={fmtNumber(totalHooks)}
          {...(hookErrors > 0
            ? { detail: `${hookErrors} err`, accent: 'error' as const }
            : {})}
        />
        <StatCard label="Tokens" value={fmtNumber(data.totalTokens)} />
        <StatCard label="Messages" value={fmtNumber(data.turns.length)} />
        <StatCard label="Cost" value={fmtCurrency(data.totalCost)} />
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
                const runningCost = cumulativeCosts[i] ?? 0;
                const hasContent = turn.spans.length > 0 || !!turn.assistantText;

                // Compactions that occurred before this turn (after previous turn)
                const prevTs = prevTurn ? prevTurn.startTime : '';
                const compactionsBefore = compactions.filter((c) =>
                  c.timestamp > prevTs && c.timestamp <= turn.startTime
                );

                return (
                  <div key={turn.index}>
                    {/* Compaction dividers */}
                    {compactionsBefore.map((c, ci) => (
                      <CompactionDivider key={`compact-${i}-${ci}`} compaction={c} />
                    ))}
                    <div
                      id={`turn-${turn.index}`}
                      className={clsx('space-y-1.5', selectedTurnIndex === turn.index && 'ring-1 ring-accent/30 rounded-sm')}
                    >
                      <UserBlock turn={turn} sessionId={sessionId} prevTurn={prevTurn} />
                      {hasContent && (
                        <ResponseBlock
                          turn={turn}
                          expanded={expandedTurns.has(turn.index)}
                          onToggle={() => toggleTurn(turn.index)}
                          sessionId={sessionId}
                          runningCost={runningCost}
                          prevContextTokens={prevTurn?.contextTokens}
                          onContextClick={showContext ? () => {
                            setShowContext(true);
                            setSelectedTurnIndex(turn.index);
                          } : undefined}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Context sidebar */}
        {showContext && data.turns.length > 0 && (
          <div className="w-80 shrink-0 sticky top-16">
            <ContextPanel
              turns={selectedTurnIndex !== null ? data.turns.slice(0, selectedTurnIndex + 1) as Turn[] : data.turns as Turn[]}
              contextFiles={contextFilesData?.files}
              onTurnClick={handleTurnClick}
            />
          </div>
        )}
      </div>

      <div ref={bottomRef} />
      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
