import { Icon } from '../../components/ui/Icon';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  useResearchQuery, useResearchFindings, useResearchThreads,
  useResearchCosts, useUpdateResearchQuery, useRateFinding,
  useInjectThread, useRunResearch, useResearchRunning,
  useResearchActivity, useCancelJob, useResearchJobs, useResearchStream,
  useResearchSteps, useUpdateThread, useDeleteResearchQuery, useUpdateQueryConfig,
  useResearchEnvCheck, useFetchThreadText, useRedoThread, useFetchFindingText,
  useGenerateDocument,
  type ResearchFinding, type ResearchThread, type ResearchActivity,
  type ResearchJob, type StreamEvent, type ResearchStep,
} from '../../api/research-hooks';
import { Button } from '../../components/ui/Button';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import cytoscape from 'cytoscape';
// @ts-expect-error cytoscape-fcose has no bundled types
import fcose from 'cytoscape-fcose';

cytoscape.use(fcose);

// suppress unused import warnings — available for future use
void (useRateFinding as unknown);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function orderThreadsDepthFirst(threads: ResearchThread[]): ResearchThread[] {
  const byParent = new Map<string | null, ResearchThread[]>();
  for (const t of threads) {
    const key = t.parent_thread_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(t);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const result: ResearchThread[] = [];
  function walk(parentId: string | null) {
    for (const t of byParent.get(parentId) ?? []) { result.push(t); walk(t.id); }
  }
  walk(null);
  return result;
}

/** Returns the seed (depth=0) ancestor id for a thread, or null if it is one. */
function findSeedAncestor(thread: ResearchThread, all: ResearchThread[]): string | null {
  if (thread.depth === 0) return thread.id;
  const byId = new Map(all.map(t => [t.id, t]));
  let cur: ResearchThread = thread;
  while (cur.parent_thread_id) {
    const parent = byId.get(cur.parent_thread_id);
    if (!parent) break;
    if (parent.depth === 0) return parent.id;
    cur = parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function ConfBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-text-muted">{label}</span>
      <div className="w-12 h-1 bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full', value > 0.7 ? 'bg-success' : value > 0.4 ? 'bg-warning' : 'bg-error')}
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <span className="text-xs text-text-muted">{(value * 100).toFixed(0)}%</span>
    </div>
  );
}

function Md({ children, className }: { children: string; className?: string }) {
  if (!children || typeof children !== 'string') return null;
  return (
    <div className={['md-content', className].filter(Boolean).join(' ')}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

const statusDotCls: Record<string, string> = {
  active: 'bg-success animate-pulse',
  queued: 'bg-warning/70',
  exhausted: 'bg-text-muted/40',
  deferred: 'bg-accent/50',
  pruned: 'bg-error/70',
  paused: 'bg-warning/50',
};

const originBadgeCls: Record<string, string> = {
  seed: 'bg-accent/10 text-accent',
  follow_up: 'bg-accent/5 text-accent/70',
  perturbation: 'bg-warning/10 text-warning',
  verify: 'bg-error/10 text-error',
  user_injected: 'bg-success/10 text-success',
  monitor_alert: 'bg-warning/15 text-warning',
};

function StatusDot({ status, className }: { status: string; className?: string }) {
  return <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', statusDotCls[status] ?? 'bg-text-muted/40', className)} />;
}

function OriginBadge({ origin }: { origin: string }) {
  if (origin === 'follow_up') return null;
  return (
    <span className={clsx('px-1.5 py-0.5 rounded text-xs font-medium shrink-0', originBadgeCls[origin] ?? 'bg-bg-tertiary text-text-muted')}>
      {origin.replace(/_/g, ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Left Sidebar — Thread Navigator
// ---------------------------------------------------------------------------

function ThreadNavigator({
  threads,
  findingCounts,
  selectedThreadId,
  onSelectThread,
  sessionId,
}: {
  threads: ResearchThread[];
  findingCounts: Map<string, number>;
  selectedThreadId: string | null;
  onSelectThread: (id: string) => void;
  sessionId: string;
}) {
  const [filter, setFilter] = useState('');
  const [viewMode, setViewMode] = useState<'hierarchical' | 'flat'>('hierarchical');
  const [newQuestion, setNewQuestion] = useState('');
  const injectThread = useInjectThread();

  const hierarchical = useMemo(() => orderThreadsDepthFirst(threads), [threads]);
  const flat = useMemo(() => [...threads].sort((a, b) => b.priority - a.priority), [threads]);
  const ordered = viewMode === 'hierarchical' ? hierarchical : flat;

  const filtered = useMemo(() => {
    if (!filter.trim()) return ordered;
    const lc = filter.toLowerCase();
    return ordered.filter(t =>
      t.query.toLowerCase().includes(lc) ||
      (t.short_query?.toLowerCase().includes(lc))
    );
  }, [ordered, filter]);

  // Expand/collapse state for hierarchical mode
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, string[]>();
    for (const t of threads) {
      const key = t.parent_thread_id ?? null;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t.id);
    }
    return m;
  }, [threads]);

  function hasChildren(id: string) {
    return (childrenOf.get(id) ?? []).length > 0;
  }

  function isHidden(t: ResearchThread): boolean {
    if (viewMode === 'flat') return false;
    let pid = t.parent_thread_id;
    while (pid) {
      if (collapsed.has(pid)) return true;
      const parent = threads.find(x => x.id === pid);
      pid = parent?.parent_thread_id ?? null;
    }
    return false;
  }

  const visibleFiltered = useMemo(() => filtered.filter(t => !isHidden(t)), [filtered, collapsed, viewMode]);

  function handleInject(e: React.FormEvent) {
    e.preventDefault();
    if (!newQuestion.trim()) return;
    injectThread.mutate({ sessionId, query: newQuestion.trim() });
    setNewQuestion('');
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-3 border-b border-border-primary space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted uppercase tracking-wide font-medium">Threads</span>
          <span className="text-xs text-text-muted tabular-nums">{threads.length}</span>
        </div>
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter threads..."
          className="w-full bg-bg-primary border border-border-primary rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent"
        />
        <div className="flex gap-1">
          {(['hierarchical', 'flat'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={clsx('flex-1 px-2 py-1 rounded text-xs transition-colors',
                viewMode === mode
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:text-text-secondary'
              )}
            >{mode === 'hierarchical' ? 'Tree' : 'Flat'}</button>
          ))}
        </div>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {visibleFiltered.map(thread => {
          const fc = findingCounts.get(thread.id) ?? 0;
          const display = thread.short_query ?? (thread.query.length > 60 ? thread.query.slice(0, 60) + '...' : thread.query);
          const isSelected = selectedThreadId === thread.id;
          const depth = viewMode === 'hierarchical' ? thread.depth : 0;
          const canExpand = viewMode === 'hierarchical' && hasChildren(thread.id);
          const isCollapsed = collapsed.has(thread.id);

          return (
            <div
              key={thread.id}
              className={clsx(
                'flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-colors border-l-2',
                isSelected ? 'bg-accent/10 border-accent' : 'border-transparent hover:bg-bg-tertiary/30'
              )}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              onClick={() => onSelectThread(thread.id)}
            >
              {canExpand ? (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    setCollapsed(prev => {
                      const n = new Set(prev);
                      n.has(thread.id) ? n.delete(thread.id) : n.add(thread.id);
                      return n;
                    });
                  }}
                  className="p-0.5 shrink-0"
                >
                  <Icon name="expand_more" size="xs" className={clsx('w-3 h-3 text-text-muted transition-transform', isCollapsed && '-rotate-90')} />
                </button>
              ) : (
                <span className="w-4 shrink-0" />
              )}
              <StatusDot status={thread.status} />
              <span className="text-xs text-text-primary truncate flex-1">{display}</span>
              {fc > 0 && (
                <span className="px-1 py-0.5 bg-bg-tertiary text-text-muted text-xs rounded shrink-0">{fc}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Inject question */}
      <form onSubmit={handleInject} className="p-3 border-t border-border-primary">
        <div className="flex gap-1.5">
          <input
            type="text"
            value={newQuestion}
            onChange={e => setNewQuestion(e.target.value)}
            placeholder="Inject question..."
            className="flex-1 bg-bg-primary border border-border-primary rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent"
          />
          <Button type="submit" variant="secondary" size="sm" loading={injectThread.isPending}>
            <Icon name="add" size="xs" />
          </Button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Document Tab
// ---------------------------------------------------------------------------

function DocumentView({
  findings, threads, onNavigateToThread, onNavigateToMap, document, sessionId,
}: {
  findings: ResearchFinding[];
  threads: ResearchThread[];
  onNavigateToThread: (threadId: string) => void;
  onNavigateToMap: (threadId: string) => void;
  document?: string;
  sessionId: string;
}) {
  const generateDoc = useGenerateDocument();
  const hasFindings = findings.length >= 3;

  // Strip markdown code fences if present
  const cleanDoc = useMemo(() => {
    if (!document) return '';
    return document.replace(/^```(?:markdown)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
  }, [document]);

  // Extract TOC from document markdown (## headings)
  const tocEntries = useMemo(() => {
    if (!cleanDoc) return [];
    const entries: { id: string; title: string; level: number }[] = [];
    for (const line of cleanDoc.split('\n')) {
      const m = line.match(/^(#{2,3})\s+(.+)/);
      if (m) {
        const title = m[2].trim();
        const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        entries.push({ id, title, level: m[1].length });
      }
    }
    return entries;
  }, [document]);

  function scrollToHeading(id: string) {
    const el = window.document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (!hasFindings) {
    return <p className="text-sm text-text-muted text-center py-12">Not enough findings yet. Run the engine to gather more research material.</p>;
  }

  if (!document) {
    return (
      <div className="text-center py-12 space-y-4">
        <p className="text-sm text-text-muted">No article generated yet.</p>
        <Button
          onClick={() => generateDoc.mutate({ sessionId })}
          loading={generateDoc.isPending}
        >
          Generate Article
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-8">
      {/* Main article */}
      <div className="flex-1 min-w-0">
        <div className="max-w-3xl mx-auto">
          {/* Regenerate control */}
          <div className="flex items-center justify-end mb-6 gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => generateDoc.mutate({ sessionId })}
              loading={generateDoc.isPending}
            >
              <Icon name="refresh" size="xs" className="mr-1" />
              Regenerate
            </Button>
          </div>

          {/* Rendered article */}
          <article className="md-content article-view text-base text-text-primary leading-[1.85]">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h2: ({ children, ...props }) => {
                  const text = String(children);
                  const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                  return <h2 id={id} className="font-heading text-xl font-semibold text-text-primary mt-10 mb-4 pb-2 border-b border-border-primary/30" {...props}>{children}</h2>;
                },
                h3: ({ children, ...props }) => {
                  const text = String(children);
                  const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                  return <h3 id={id} className="font-heading text-lg font-medium text-text-primary mt-8 mb-3" {...props}>{children}</h3>;
                },
                p: ({ children }) => <p className="mb-4 text-text-secondary">{children}</p>,
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{children}</a>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-[3px] border-accent/30 pl-4 my-4 text-text-muted italic">{children}</blockquote>
                ),
                ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-1 text-text-secondary">{children}</ol>,
                ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-1 text-text-secondary">{children}</ul>,
              }}
            >
              {cleanDoc}
            </ReactMarkdown>
          </article>

          {/* Bibliography */}
          {findings.length > 0 && (
            <ReferencesSection findings={findings} />
          )}
        </div>
      </div>

      {/* Sidebar TOC */}
      {tocEntries.length > 2 && (
        <div className="w-52 shrink-0 hidden xl:block">
          <div className="sticky top-4 space-y-0.5">
            <p className="text-xs text-text-muted uppercase tracking-wide mb-2 font-medium">Contents</p>
            {tocEntries.map((entry, idx) => (
              <button
                key={idx}
                onClick={() => scrollToHeading(entry.id)}
                className={clsx(
                  'block w-full text-left py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/30 rounded truncate transition-colors',
                  entry.level === 2 ? 'px-2' : 'px-4 text-text-muted'
                )}
              >
                {entry.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// References (bibliography-style, part of the article typographic system)
// ---------------------------------------------------------------------------

function domainFrom(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function RefEntry({ finding, index }: { finding: ResearchFinding; index: number }) {
  const [open, setOpen] = useState(false);
  const sources = finding.source_url_meta?.length
    ? finding.source_url_meta
    : finding.source_urls.map(url => ({ url, title: '', snippet: '' }));
  const domains = [...new Set(sources.map(s => domainFrom(s.url)))];

  return (
    <div className="group">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left py-2 flex items-start gap-3 transition-colors"
      >
        <span className="text-xs text-text-muted font-mono shrink-0 mt-0.5 w-5 text-right">{index}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-secondary leading-relaxed group-hover:text-text-primary transition-colors">
            {finding.summary}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {domains.length > 0 && (
              <span className="text-xs text-text-muted">
                {domains.slice(0, 2).join(' · ')}{domains.length > 2 ? ` · +${domains.length - 2}` : ''}
              </span>
            )}
            {domains.length > 0 && finding.tags.length > 0 && (
              <span className="text-text-disabled">·</span>
            )}
            {finding.tags.map(tag => (
              <span key={tag} className="text-xs text-text-muted">{tag}</span>
            ))}
            <span className="text-xs text-text-disabled ml-auto">
              {(finding.confidence * 100).toFixed(0)}% conf
              {finding.novelty > 0.3 && <>{' · '}{(finding.novelty * 100).toFixed(0)}% novel</>}
            </span>
          </div>
        </div>
      </button>

      {open && (
        <div className="ml-8 pb-3 space-y-2">
          {sources.length > 0 && (
            <div className="space-y-0.5">
              {sources.map((src, i) => (
                <a
                  key={i}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs hover:underline truncate"
                  title={src.url}
                >
                  <span className="text-text-muted">{domainFrom(src.url)}</span>
                  {src.title && <span className="text-accent ml-1.5">{src.title}</span>}
                  {!src.title && <span className="text-accent ml-1.5">{src.url}</span>}
                </a>
              ))}
            </div>
          )}

          {finding.follow_ups.length > 0 && (
            <p className="text-xs text-text-muted italic leading-relaxed">
              See also: {finding.follow_ups.join('; ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ReferencesSection({ findings }: { findings: ResearchFinding[] }) {
  const sorted = useMemo(
    () => [...findings].sort((a, b) => b.confidence - a.confidence),
    [findings],
  );

  return (
    <div className="mt-12">
      <hr className="border-border-primary/30 mb-10" />
      <h2 className="font-heading text-xl font-semibold text-text-primary mb-6 pb-2 border-b border-border-primary/30">
        References
      </h2>
      <div className="space-y-0.5">
        {sorted.map((f, i) => <RefEntry key={f.id} finding={f} index={i + 1} />)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Tab
// ---------------------------------------------------------------------------

function ThreadLiveRow({
  thread, steps, threadFindings, childThreads, parentThread, depth, expanded, onToggle, sessionId,
  workerLabel, onViewInDocument, onShowOnMap, showInlineConfig, onToggleConfig,
}: {
  thread: ResearchThread;
  steps: ResearchStep[];
  threadFindings: ResearchFinding[];
  childThreads: ResearchThread[];
  parentThread: ResearchThread | null;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  sessionId: string;
  workerLabel: string | null;
  onViewInDocument: () => void;
  onShowOnMap: () => void;
  showInlineConfig: boolean;
  onToggleConfig: () => void;
}) {
  const updateThread = useUpdateThread();
  const fetchThreadText = useFetchThreadText();
  const redoThread = useRedoThread();
  const fetchFindingText = useFetchFindingText();
  const isTerminal = thread.status === 'exhausted' || thread.status === 'pruned';

  const timelineSteps = [...steps].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const followUpCandidates = threadFindings.flatMap(f => f.follow_up_analysis?.candidates ?? []);
  const hasAnalysis = threadFindings.some(f => f.follow_up_analysis);
  const childQuerySet = new Set(childThreads.map(t => t.query.toLowerCase().trim()));

  const displayText = thread.short_query ?? (thread.query.length > 100 ? thread.query.slice(0, 100) + '...' : thread.query);
  const threadFetch = thread.fetch_source_text;

  function handleFetchToggle() {
    const newVal = threadFetch === true ? false : threadFetch === false ? null : true;
    updateThread.mutate({ id: thread.id, sessionId, fetch_source_text: newVal });
    if (newVal === true && isTerminal) {
      fetchThreadText.mutate({ sessionId, threadId: thread.id });
    }
  }

  return (
    <div style={{ marginLeft: depth * 18 }}>
      <div className="flex items-center gap-1 group">
        <button
          onClick={onToggle}
          className="flex-1 flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-bg-tertiary/30 transition-colors text-left"
        >
          <div className="flex items-center gap-1.5 mt-1 shrink-0">
            <StatusDot status={thread.status} />
            {workerLabel && (
              <span className="text-xs font-mono text-accent/70">{workerLabel}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base text-text-primary leading-snug">
                {displayText}
              </span>
              <OriginBadge origin={thread.origin} />
              {thread.priority !== undefined && (
                <span className="text-xs text-text-muted font-mono shrink-0">p:{thread.priority.toFixed(2)}</span>
              )}
              {thread.status === 'exhausted' && threadFindings.length > 0 && (
                <span className="text-xs text-text-muted shrink-0">{threadFindings.length} finding{threadFindings.length !== 1 ? 's' : ''}</span>
              )}
              {thread.status === 'active' && (
                <span className="text-xs text-success shrink-0">running...</span>
              )}
              {threadFetch !== null && (
                <span className={clsx('px-1 py-0.5 rounded text-xs shrink-0 font-mono',
                  threadFetch ? 'bg-success/10 text-success' : 'bg-error/10 text-error/70'
                )}>
                  {threadFetch ? <><Icon name="check" size="xs" className="text-green-400" /> full-text</> : <><Icon name="close" size="xs" className="text-red-400" /> full-text</>}
                </span>
              )}
            </div>
          </div>
          <Icon name="expand_more" size="xs" className={clsx('w-3.5 h-3.5 text-text-muted shrink-0 mt-1 transition-transform', expanded && 'rotate-180')} />
        </button>
        {/* Hover controls */}
        <div className="flex items-center gap-0.5 pr-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
          <button
            title="Thread config"
            onClick={onToggleConfig}
            className={clsx('p-1 rounded text-xs', showInlineConfig ? 'text-accent' : 'text-text-muted hover:text-text-primary')}
          ><Icon name="tune" size="xs" /></button>
          <button
            title="Increase priority"
            onClick={() => updateThread.mutate({ id: thread.id, sessionId, priority: Math.min(1.0, thread.priority + 0.1) })}
            className="p-1 text-text-muted hover:text-text-primary rounded"
          ><Icon name="keyboard_arrow_up" size="xs" /></button>
          <button
            title="Decrease priority"
            onClick={() => updateThread.mutate({ id: thread.id, sessionId, priority: Math.max(0.0, thread.priority - 0.1) })}
            className="p-1 text-text-muted hover:text-text-primary rounded"
          ><Icon name="keyboard_arrow_down" size="xs" /></button>
          {!isTerminal && (
            <button
              title="Reject thread"
              onClick={() => updateThread.mutate({ id: thread.id, sessionId, status: 'pruned' })}
              className="p-1 text-text-muted hover:text-red-400 rounded text-xs"
            ><Icon name="close" size="xs" /></button>
          )}
        </div>
      </div>

      {/* Inline config panel */}
      {showInlineConfig && (
        <div className="ml-5 pl-3 border-l border-accent/30 py-2 mb-1 bg-bg-secondary/50 rounded-r-lg space-y-2">
          <div className="flex items-center gap-4 text-xs text-text-muted">
            <span>Priority: <span className="text-text-primary font-mono">{thread.priority.toFixed(2)}</span></span>
            <span>Max depth: <span className="text-text-primary font-mono">{thread.max_depth}</span></span>
            <span>Depth: <span className="text-text-primary font-mono">{thread.depth}</span></span>
          </div>
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={thread.priority}
              onChange={e => updateThread.mutate({ id: thread.id, sessionId, priority: Number(e.target.value) })}
              className="w-32 accent-accent"
            />
            <span className="text-xs text-text-muted font-mono w-8">{thread.priority.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <span className="text-xs text-text-muted">Fetch source text:</span>
            <button
              onClick={handleFetchToggle}
              className={clsx('px-2 py-0.5 rounded text-xs border transition-colors',
                threadFetch === true ? 'bg-green-900/40 border-green-700/40 text-green-400'
                  : threadFetch === false ? 'bg-red-900/30 border-red-700/30 text-red-400/70'
                    : 'bg-bg-secondary border-border-primary text-text-muted/50'
              )}
            >{threadFetch === true ? 'ON' : threadFetch === false ? 'OFF' : 'Default'}</button>
          </div>
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            {isTerminal && (
              <button
                onClick={() => redoThread.mutate({ sessionId, threadId: thread.id })}
                disabled={redoThread.isPending}
                className="px-1.5 py-0.5 text-text-muted hover:text-blue-400 rounded text-xs border border-border-primary hover:border-blue-700/40"
              >redo</button>
            )}
            {isTerminal && (
              <button
                onClick={() => redoThread.mutate({ sessionId, threadId: thread.id, fetch_source_text: true })}
                disabled={redoThread.isPending}
                className="px-1.5 py-0.5 text-text-muted hover:text-green-400 rounded text-xs border border-border-primary hover:border-green-700/40 font-mono"
              >redo+txt</button>
            )}
          </div>
          <div className="text-xs text-text-muted/60 space-y-0.5">
            <p>ID: <span className="font-mono">{thread.id}</span></p>
            <p>Origin: {thread.origin} | Depth: {thread.depth} | Created: {new Date(thread.created_at).toLocaleTimeString()}</p>
            <p>Findings: {threadFindings.length} | Children: {childThreads.length}</p>
          </div>
        </div>
      )}

      {expanded && (
        <div className="ml-5 pl-3 border-l border-border-primary/40 pb-1 space-y-1">
          {/* Full query */}
          {(thread.short_query || thread.query.length > 100) && (
            <p className="text-base text-text-secondary py-1 leading-relaxed">{thread.query}</p>
          )}

          {/* Fetch/redo controls */}
          <div className="flex items-center gap-2 py-0.5" onClick={e => e.stopPropagation()}>
            <button
              title={threadFetch === true ? 'Full-text ON' : threadFetch === false ? 'Full-text OFF' : 'Full-text: session default'}
              onClick={handleFetchToggle}
              className={clsx('px-1.5 py-0.5 rounded text-xs border transition-colors',
                threadFetch === true ? 'bg-green-900/40 border-green-700/40 text-green-400 hover:bg-green-900/60'
                  : threadFetch === false ? 'bg-red-900/30 border-red-700/30 text-red-400/70 hover:bg-red-900/50'
                    : 'bg-bg-secondary border-border-primary text-text-muted/50 hover:text-text-muted'
              )}
            >txt</button>
            {isTerminal && (
              <button
                onClick={() => redoThread.mutate({ sessionId, threadId: thread.id })}
                disabled={redoThread.isPending}
                className="px-1.5 py-0.5 text-text-muted hover:text-blue-400 rounded text-xs border border-border-primary hover:border-blue-700/40"
              >&#x21ba; redo</button>
            )}
            {isTerminal && (
              <button
                onClick={() => redoThread.mutate({ sessionId, threadId: thread.id, fetch_source_text: true })}
                disabled={redoThread.isPending}
                className="px-1.5 py-0.5 text-text-muted hover:text-green-400 rounded text-xs border border-border-primary hover:border-green-700/40 font-mono"
              >&#x21ba; redo+txt</button>
            )}
          </div>

          {/* Thread metadata */}
          <div className="flex items-center gap-3 py-0.5 text-xs text-text-secondary">
            <span>created {new Date(thread.created_at).toLocaleTimeString()}</span>
            <span>depth {thread.depth}/{thread.max_depth}</span>
            {thread.id && <span className="font-mono">{thread.id}</span>}
          </div>

          {/* Perturbation info */}
          {thread.origin === 'perturbation' && thread.perturbation_strategy && (
            <div className="py-1 px-2 bg-orange-900/10 border border-orange-800/30 rounded text-xs space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-orange-400 font-medium">perturbation</span>
                <span className="text-orange-300/70 font-mono">{thread.perturbation_strategy}</span>
              </div>
              {parentThread && (
                <div>
                  <span className="text-text-muted/60">original: </span>
                  <span className="text-text-muted/80 italic">{parentThread.query}</span>
                </div>
              )}
            </div>
          )}

          {steps.length === 0 && threadFindings.length === 0 && (
            <p className="text-sm text-text-muted py-1 italic">waiting to run...</p>
          )}

          {/* Timeline: steps */}
          {timelineSteps.map((step, si) => (
            <div key={step.id} className="py-0.5 space-y-1">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span className="text-blue-400/80 font-mono shrink-0">llm</span>
                <span className="font-mono">{step.model}</span>
                <span className="text-text-muted/70">{step.prompt_tokens + step.completion_tokens} tok</span>
                {step.cost_usd > 0 && <span className="text-text-muted/70">${step.cost_usd.toFixed(4)}</span>}
                {step.duration_ms && <span className="text-text-muted/70">{(step.duration_ms / 1000).toFixed(1)}s</span>}
                <span className="text-text-muted/40 ml-auto">{new Date(step.created_at).toLocaleTimeString()}</span>
              </div>
              {step.error && (
                <div className="flex items-start gap-1.5 pl-4">
                  <span className="text-red-400 text-xs shrink-0">error:</span>
                  <span className="text-xs text-red-300 break-words">{step.error}</span>
                </div>
              )}
              {step.tool_calls.length === 0 && step.label && (
                <span className="pl-4 text-xs text-text-muted/70 italic">{step.label}</span>
              )}
              {step.tool_calls.length === 0 && !step.label && !step.error && (
                <span className="pl-4 text-xs text-text-muted/40 italic">no tool calls</span>
              )}
              {step.tool_calls.map((tc, ti) => (
                <div key={`${si}-${ti}`} className="pl-4 space-y-0.5">
                  <div className="flex items-start gap-2">
                    <span className="text-text-secondary/80 text-xs font-mono shrink-0">{tc.tool}</span>
                    {tc.input && (
                      <span className="text-sm text-text-primary break-words flex-1">
                        {tc.tool === 'web_search' && tc.input.query
                          ? <span className="text-text-primary">"{tc.input.query as string}"</span>
                          : <span className="text-text-secondary/70 text-xs">{JSON.stringify(tc.input).slice(0, 120)}</span>}
                      </span>
                    )}
                    {tc.error && (
                      <span className="flex items-center gap-0.5 text-xs text-red-400 shrink-0" title={tc.error}><Icon name="close" size="xs" /> error</span>
                    )}
                  </div>
                  {tc.jina_fetches && tc.jina_fetches.length > 0 && (
                    <div className="pl-4 space-y-0.5">
                      {tc.jina_fetches.map((jf, ji) => {
                        let hostname = jf.url;
                        try { hostname = new URL(jf.url).hostname; } catch { /* keep url */ }
                        return (
                          <div key={ji} className="flex items-center gap-2">
                            <span className={clsx('text-xs shrink-0', jf.ok ? 'text-green-400' : 'text-red-400')}>
                              <Icon name={jf.ok ? 'check' : 'close'} size="xs" />
                            </span>
                            <a href={jf.url} target="_blank" rel="noreferrer"
                              className="text-xs text-accent hover:underline truncate max-w-[300px]">{hostname}</a>
                            {jf.ok
                              ? <span className="text-xs text-text-muted/60 shrink-0">{(jf.content_length / 1000).toFixed(1)}k</span>
                              : <span className="text-xs text-red-400/70 shrink-0" title={jf.error ?? 'fetch failed'}>{jf.error ?? 'failed'}</span>
                            }
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {tc.error && (
                    <div className="pl-4 text-xs text-red-400/80 break-words">{tc.error}</div>
                  )}
                </div>
              ))}
            </div>
          ))}

          {/* Findings */}
          {threadFindings.map(f => (
            <div key={f.id} className="flex items-start gap-2 py-1 bg-green-900/10 rounded px-2 mt-1 group/finding">
              <Icon name="check" size="sm" className="text-green-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-base text-text-primary">{f.summary}</p>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  <span className="text-xs text-text-muted" title="Confidence score">conf {(f.confidence * 100).toFixed(0)}%</span>
                  <span className="text-xs text-text-muted" title="Novelty score">novel {(f.novelty * 100).toFixed(0)}%</span>
                  <span className="text-xs text-text-muted" title="Actionability score">act {(f.actionability * 100).toFixed(0)}%</span>
                  {f.source_urls.length > 0 && <span className="text-xs text-text-muted">{f.source_urls.length} src</span>}
                  {f.source_texts.filter(t => t.length > 0).length > 0
                    ? <span className="text-xs text-green-400/70">{f.source_texts.filter(t => t.length > 0).length} full-text</span>
                    : f.source_urls.length > 0 && (
                      <button
                        title="Fetch full-text for this finding's sources"
                        onClick={() => fetchFindingText.mutate({ sessionId, findingId: f.id })}
                        disabled={fetchFindingText.isPending}
                        className="text-xs text-text-muted/50 hover:text-green-400 font-mono opacity-0 group-hover/finding:opacity-100 transition-opacity"
                      >&#x2193;txt</button>
                    )
                  }
                  {f.confidence < 0.4 && <span className="text-xs text-red-400">low confidence</span>}
                </div>
              </div>
            </div>
          ))}

          {/* Follow-up analysis */}
          {hasAnalysis && (
            <div className="mt-1.5 pt-1 border-t border-border-primary/30">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-xs text-text-muted uppercase tracking-wide">Follow-up analysis</p>
                {(threadFindings[0]?.follow_up_analysis?.retry_count ?? 0) > 0 && (
                  <span className="text-xs text-text-muted/60">{threadFindings[0]?.follow_up_analysis?.retry_count} retries</span>
                )}
                <span className="text-xs text-text-muted/60">threshold: {((threadFindings[0]?.follow_up_analysis?.similarity_threshold ?? 0.75) * 100).toFixed(0)}%</span>
              </div>
              {followUpCandidates.map((c, i) => {
                const spawned = childQuerySet.has((c.text ?? '').toLowerCase().trim());
                return (
                  <div key={i} className={clsx('py-0.5 px-1 rounded mb-0.5', c.accepted ? '' : 'opacity-50')}>
                    <div className="flex items-start gap-1.5">
                      <span className={clsx('text-xs shrink-0 mt-0.5', c.accepted ? 'text-purple-400' : 'text-text-muted')}>
                        {c.accepted ? (spawned ? <Icon name="arrow_forward" size="xs" /> : <span>&#xb7;</span>) : <Icon name="close" size="xs" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className={clsx('text-sm break-words', c.accepted ? (spawned ? 'text-text-secondary' : 'text-text-muted') : 'text-text-muted/50 line-through')}>{c.text}</span>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-text-muted/70" title="Quality score">quality:{(c.quality_score*100).toFixed(0)}%</span>
                          <span className="text-xs text-text-muted/70" title="Rank score">rank:{(c.rank_score*100).toFixed(0)}%</span>
                          <span className="text-xs text-text-muted/70" title="Distance from parent">dist:{(c.distance_from_parent*100).toFixed(0)}%</span>
                          <span className={clsx('text-xs', c.jaccard_similarity > (threadFindings[0]?.follow_up_analysis?.similarity_threshold ?? 0.75) ? 'text-red-400' : 'text-text-muted/70')}
                            title="Jaccard similarity">
                            Jaccard:{(c.jaccard_similarity*100).toFixed(0)}%
                          </span>
                          {c.embedding_similarity !== null && c.embedding_similarity !== undefined && (
                            <span className="text-xs text-text-muted/70" title="Embedding similarity">emb:{(c.embedding_similarity*100).toFixed(0)}%</span>
                          )}
                          {c.llm_similarity !== null && c.llm_similarity !== undefined && (
                            <span className="text-xs text-text-muted/70" title="LLM similarity">llm:{(c.llm_similarity*100).toFixed(0)}%</span>
                          )}
                          {c.similarity_method !== 'jaccard' && (
                            <span className="text-xs text-accent/70 font-mono">[{c.similarity_method}]</span>
                          )}
                          {c.accepted && spawned && <span className="text-xs text-purple-400">spawned</span>}
                          {!c.accepted && c.rejection_reason && (
                            <span className="text-xs text-red-400/70 italic truncate max-w-[120px]" title={c.rejection_reason}>{c.rejection_reason}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Fallback: old follow_ups */}
          {!hasAnalysis && threadFindings.some(f => (f.follow_ups ?? []).length > 0) && (
            <div className="mt-1.5 pt-1 border-t border-border-primary/30">
              <p className="text-xs text-text-muted uppercase tracking-wide mb-0.5">Follow-ups</p>
              {Array.from(new Set(threadFindings.flatMap(f => f.follow_ups ?? []))).map((q, i) => {
                const spawned = childQuerySet.has(q.toLowerCase().trim());
                return (
                  <div key={i} className="flex items-start gap-1.5 py-0.5">
                    <span className="text-xs text-text-muted shrink-0 mt-0.5">{spawned ? '\u2192' : '\u00b7'}</span>
                    <span className={clsx('text-sm break-words', spawned ? 'text-text-secondary' : 'text-text-muted')}>{q}</span>
                    {spawned && <span className="text-xs text-purple-400 shrink-0 mt-0.5">spawned</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Cross-nav links */}
          <div className="flex items-center gap-4 pt-1 border-t border-border-primary/20">
            <button onClick={onViewInDocument} className="text-xs text-accent hover:underline">
              View in document &rarr;
            </button>
            <button onClick={onShowOnMap} className="text-xs text-accent hover:underline">
              Show on map &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LiveView({
  threads, findings, allSteps, events, isRunning, sessionId, sessionFetchText,
  onToggleSessionFetch, activity, jobs, selectedThreadId, onSelectThread,
  onNavigateToDocument, onNavigateToMap,
}: {
  threads: ResearchThread[];
  findings: ResearchFinding[];
  allSteps: ResearchStep[];
  events: StreamEvent[];
  isRunning: boolean;
  sessionId: string;
  sessionFetchText: boolean;
  onToggleSessionFetch: () => void;
  activity: ResearchActivity | undefined;
  jobs: ResearchJob[];
  selectedThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNavigateToDocument: (threadId: string) => void;
  onNavigateToMap: (threadId: string) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'hierarchical' | 'flat'>('hierarchical');
  const [configThreadId, setConfigThreadId] = useState<string | null>(null);

  // Auto-expand active threads
  useEffect(() => {
    const activeIds = threads.filter(t => t.status === 'active').map(t => t.id);
    if (activeIds.length > 0) {
      setExpandedIds(prev => {
        const next = new Set(prev);
        for (const id of activeIds) next.add(id);
        return next;
      });
    }
  }, [threads]);

  // Auto-expand selected thread
  useEffect(() => {
    if (selectedThreadId) {
      setExpandedIds(prev => {
        const next = new Set(prev);
        next.add(selectedThreadId);
        return next;
      });
    }
  }, [selectedThreadId]);

  const stepsByThread = useMemo(() => {
    const map = new Map<string, ResearchStep[]>();
    const seen = new Set<string>();
    for (const s of allSteps) {
      const arr = map.get(s.thread_id) ?? [];
      arr.push(s);
      map.set(s.thread_id, arr);
      seen.add(s.id);
    }
    for (const e of events) {
      if (e.type !== 'step') continue;
      if (seen.has(e.payload.id)) continue;
      const arr = map.get(e.payload.thread_id) ?? [];
      arr.push(e.payload);
      map.set(e.payload.thread_id, arr);
    }
    return map;
  }, [allSteps, events]);

  const findingsByThread = useMemo(() => {
    const map = new Map<string, ResearchFinding[]>();
    for (const f of findings) {
      const arr = map.get(f.thread_id) ?? [];
      arr.push(f);
      map.set(f.thread_id, arr);
    }
    return map;
  }, [findings]);

  const childrenByThread = useMemo(() => {
    const map = new Map<string, ResearchThread[]>();
    for (const t of threads) {
      if (!t.parent_thread_id) continue;
      const arr = map.get(t.parent_thread_id) ?? [];
      arr.push(t);
      map.set(t.parent_thread_id, arr);
    }
    return map;
  }, [threads]);

  const threadById = useMemo(() => {
    const map = new Map<string, ResearchThread>();
    for (const t of threads) map.set(t.id, t);
    return map;
  }, [threads]);

  // Worker label per thread: match running jobs to active threads
  const workerByThread = useMemo(() => {
    const map = new Map<string, string>();
    const activeThread = activity?.active_thread;
    if (activeThread) {
      const runningJob = jobs.find(j => (j.status === 'running' || j.status === 'claimed') && j.claimed_by);
      if (runningJob?.claimed_by) {
        map.set(activeThread.id, runningJob.claimed_by.slice(0, 12));
      }
    }
    return map;
  }, [activity, jobs]);

  const orderedHierarchical = useMemo(() => orderThreadsDepthFirst(threads), [threads]);
  const orderedFlat = useMemo(() => [...threads].sort((a, b) => b.priority - a.priority), [threads]);
  const ordered = viewMode === 'flat' ? orderedFlat : orderedHierarchical;

  if (ordered.length === 0) {
    return <p className="text-sm text-text-muted text-center py-12">No threads yet. Run the engine to start.</p>;
  }

  return (
    <div className="space-y-0.5">
      {/* Controls bar */}
      <div className="flex items-center gap-3 px-1 pb-2 mb-1 border-b border-border-primary/30">
        <span className="text-xs text-text-muted">Full-text fetch:</span>
        <button
          onClick={onToggleSessionFetch}
          className={clsx('px-2 py-1 rounded text-xs font-medium border transition-colors',
            sessionFetchText
              ? 'bg-green-900/40 border-green-700/40 text-green-300 hover:bg-green-900/60'
              : 'bg-bg-secondary border-border-primary text-text-muted hover:border-border-secondary hover:text-text-secondary'
          )}
        >{sessionFetchText ? 'ON' : 'OFF'}</button>
        <div className="ml-auto flex items-center gap-1">
          {(['hierarchical', 'flat'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={clsx('px-2 py-1 rounded text-xs border transition-colors',
                viewMode === mode
                  ? 'bg-accent/10 border-accent/30 text-accent'
                  : 'bg-bg-secondary border-border-primary text-text-muted hover:text-text-secondary'
              )}
            >{mode}</button>
          ))}
        </div>
      </div>

      {isRunning && (
        <div className="flex items-center gap-2 px-3 py-2 bg-success/5 border border-success/20 rounded-lg mb-3">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse shrink-0" />
          <span className="text-sm text-success font-medium">Running</span>
        </div>
      )}

      {ordered.map(thread => (
        <ThreadLiveRow
          key={thread.id}
          thread={thread}
          steps={stepsByThread.get(thread.id) ?? []}
          threadFindings={findingsByThread.get(thread.id) ?? []}
          childThreads={childrenByThread.get(thread.id) ?? []}
          parentThread={thread.parent_thread_id ? (threadById.get(thread.parent_thread_id) ?? null) : null}
          depth={viewMode === 'flat' ? 0 : thread.depth}
          expanded={expandedIds.has(thread.id)}
          onToggle={() => {
            onSelectThread(thread.id);
            setExpandedIds(prev => {
              const next = new Set(prev);
              next.has(thread.id) ? next.delete(thread.id) : next.add(thread.id);
              return next;
            });
          }}
          sessionId={sessionId}
          workerLabel={workerByThread.get(thread.id) ?? null}
          onViewInDocument={() => onNavigateToDocument(thread.id)}
          onShowOnMap={() => onNavigateToMap(thread.id)}
          showInlineConfig={configThreadId === thread.id}
          onToggleConfig={() => setConfigThreadId(prev => prev === thread.id ? null : thread.id)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map Tab — Force-directed graph (Cytoscape.js + fcose)
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  active:    '#a6e3a1',
  running:   '#a6e3a1',
  exhausted: '#6c7086',
  pruned:    '#f38ba8',
  pending:   '#f9e2af',
};
const DEFAULT_NODE_COLOR = '#89b4fa';

function MapView({
  threads, findingCounts, onNavigateToLive,
}: {
  threads: ResearchThread[];
  findingCounts: Map<string, number>;
  onNavigateToLive: (threadId: string) => void;
}) {
  const [depthFilter, setDepthFilter] = useState<'all' | '0-2' | '3-5' | '6+'>('all');
  const [hideExhausted, setHideExhausted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const filtered = useMemo(() => {
    let list = threads;
    if (depthFilter !== 'all') {
      const [min, max] = depthFilter === '0-2' ? [0, 2] : depthFilter === '3-5' ? [3, 5] : [6, 999];
      list = list.filter(t => t.depth >= min && t.depth <= max);
    }
    if (hideExhausted) list = list.filter(t => t.status !== 'exhausted');
    return list;
  }, [threads, depthFilter, hideExhausted]);

  const handleNodeTap = useCallback((threadId: string) => {
    onNavigateToLive(threadId);
  }, [onNavigateToLive]);

  // Build elements from filtered threads
  const elements = useMemo(() => {
    const filteredIds = new Set(filtered.map(t => t.id));
    const seedIds = new Set(filtered.filter(t => t.depth === 0).map(t => t.id));

    // Compound parent nodes for seed threads
    const compoundNodes: cytoscape.ElementDefinition[] = [...seedIds].map(id => ({
      data: { id: `compound-${id}` },
    }));

    const nodes: cytoscape.ElementDefinition[] = filtered.map(t => {
      const raw = t.short_query ?? t.query;
      const label = (raw.length > 30 ? raw.slice(0, 30) + '…' : raw);
      const fc = findingCounts.get(t.id) ?? 0;
      const displayLabel = fc > 0 ? `${label} [${fc}]` : label;
      const seedAncestor = findSeedAncestor(t, threads);
      const parent = seedAncestor ? `compound-${seedAncestor}` : undefined;
      return {
        data: {
          id: t.id,
          label: displayLabel,
          status: t.status,
          depth: t.depth,
          origin: t.origin,
          findingCount: fc,
          parent,
        },
      };
    });

    const edges: cytoscape.ElementDefinition[] = filtered
      .filter(t => t.parent_thread_id && filteredIds.has(t.parent_thread_id))
      .map(t => ({
        data: {
          id: `edge-${t.parent_thread_id}-${t.id}`,
          source: t.parent_thread_id!,
          target: t.id,
        },
      }));

    return [...compoundNodes, ...nodes, ...edges];
  }, [filtered, findingCounts, threads]);

  // Initialize cytoscape once
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node[label]',
          style: {
            'background-color': (ele: cytoscape.NodeSingular) =>
              STATUS_COLORS[ele.data('status') as string] ?? DEFAULT_NODE_COLOR,
            'label': 'data(label)',
            'color': '#1e1e2e',
            'font-size': '10px',
            'font-weight': 'bold',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '120px',
            'shape': 'round-rectangle',
            'width': (ele: cytoscape.NodeSingular) => {
              const lbl = ele.data('label') as string | undefined;
              return Math.max(80, Math.min(140, (lbl?.length ?? 10) * 6));
            },
            'height': 32,
            'padding': '6px',
            'border-width': 1,
            'border-color': '#313147',
          } as cytoscape.Css.Node,
        },
        {
          selector: '$node > node',
          style: {
            'background-color': '#1e1e2e',
            'background-opacity': 0.5,
            'border-color': '#89b4fa',
            'border-width': 1.5,
            'padding': '20px',
          } as cytoscape.Css.Node,
        },
        {
          selector: 'node[origin = "seed"]',
          style: {
            'border-color': '#89b4fa',
            'border-width': 2,
          } as cytoscape.Css.Node,
        },
        {
          selector: 'edge',
          style: {
            'line-color': '#313147',
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#313147',
            'arrow-scale': 0.8,
            'width': 1.5,
          } as cytoscape.Css.Edge,
        },
        {
          selector: 'edge.highlighted',
          style: {
            'line-color': '#89b4fa',
            'target-arrow-color': '#89b4fa',
            'width': 2.5,
          } as cytoscape.Css.Edge,
        },
        {
          selector: 'node.dimmed',
          style: { 'opacity': 0.3 } as cytoscape.Css.Node,
        },
      ],
      layout: {
        name: 'fcose',
        animate: true,
        animationDuration: 500,
        nodeRepulsion: 8000,
        idealEdgeLength: 80,
        gravity: 0.25,
        gravityRange: 3.8,
        nodeSeparation: 75,
      } as cytoscape.LayoutOptions,
    });

    cy.on('tap', 'node[status]', (evt) => {
      const id = evt.target.data('id') as string;
      handleNodeTap(id);
    });

    cy.on('mouseover', 'node[status]', (evt) => {
      const node = evt.target as cytoscape.NodeSingular;
      cy.elements().not(node.connectedEdges()).not(node).addClass('dimmed');
      node.connectedEdges().addClass('highlighted');
    });

    cy.on('mouseout', 'node[status]', () => {
      cy.elements().removeClass('dimmed highlighted');
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update elements and re-run layout when data/filters change
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().remove();
    cy.add(elements);
    cy.layout({
      name: 'fcose',
      animate: true,
      animationDuration: 500,
      nodeRepulsion: 8000,
      idealEdgeLength: 80,
      gravity: 0.25,
      gravityRange: 3.8,
      nodeSeparation: 75,
    } as cytoscape.LayoutOptions).run();
  }, [elements]);

  const resetLayout = useCallback(() => {
    cyRef.current?.layout({
      name: 'fcose',
      animate: true,
      animationDuration: 500,
      nodeRepulsion: 8000,
      idealEdgeLength: 80,
      gravity: 0.25,
      gravityRange: 3.8,
      nodeSeparation: 75,
    } as cytoscape.LayoutOptions).run();
  }, []);

  if (threads.length === 0) {
    return <p className="text-sm text-text-muted text-center py-12">No threads yet.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-text-muted">Depth:</span>
        {(['all', '0-2', '3-5', '6+'] as const).map(d => (
          <button
            key={d}
            onClick={() => setDepthFilter(d)}
            className={clsx('px-2 py-1 rounded text-xs border transition-colors',
              depthFilter === d
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'bg-bg-secondary border-border-primary text-text-muted hover:text-text-secondary'
            )}
          >{d === 'all' ? 'All' : d}</button>
        ))}
        <label className="ml-4 flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={hideExhausted} onChange={e => setHideExhausted(e.target.checked)} className="accent-accent" />
          <span className="text-xs text-text-muted">Hide exhausted</span>
        </label>
        <button
          onClick={resetLayout}
          className="ml-auto px-2 py-1 rounded text-xs border bg-bg-secondary border-border-primary text-text-muted hover:text-text-secondary transition-colors"
        >Reset layout</button>
      </div>

      {/* Graph */}
      <div ref={containerRef} className="w-full h-[500px] bg-bg-primary border border-border-primary rounded-lg" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings Tab
// ---------------------------------------------------------------------------

function EnvBadge({ set, label }: { set: boolean; label: string }) {
  return set
    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />{label}</span>
    : <span className="inline-flex items-center gap-1 text-xs font-medium text-error"><span className="w-1.5 h-1.5 rounded-full bg-error inline-block" />{label} not set</span>;
}

function SettingsView({
  session, sessionId, onDelete,
}: {
  session: { id: string; title: string; config: Record<string, unknown> };
  sessionId: string;
  onDelete: () => void;
}) {
  const updateConfig = useUpdateQueryConfig();
  const updateQuery = useUpdateResearchQuery();
  const { data: envCheck } = useResearchEnvCheck();
  const cfg = session.config as Record<string, unknown>;
  const providers = (cfg.providers as Record<string, unknown>) ?? {};
  const gapAnalysis = (cfg.gap_analysis as Record<string, unknown>) ?? {};

  const [title, setTitle] = useState(session.title);
  const [provider, setProvider] = useState<string>((providers.primary as string) ?? 'anthropic');
  const [model, setModel] = useState<string>((cfg.model as string) ?? '');
  const [maxDepth, setMaxDepth] = useState<number>((cfg.max_thread_depth as number) ?? 8);
  const [minSearches, setMinSearches] = useState<number>((cfg.min_searches_per_thread as number) ?? 2);
  const [gapEnabled, setGapEnabled] = useState<boolean>((gapAnalysis.enabled as boolean) ?? true);
  const [maxGapSearches, setMaxGapSearches] = useState<number>((gapAnalysis.max_gap_searches as number) ?? 2);
  const [fetchSourceText, setFetchSourceText] = useState<boolean>((cfg.fetch_source_text as boolean) ?? false);
  const [openrouterKey, setOpenrouterKey] = useState<string>((providers.openrouter_api_key as string) ?? '');
  const [openrouterModels, setOpenrouterModels] = useState<string>(
    ((providers.openrouter_models as string[]) ?? []).join(', ')
  );
  const [localModel, setLocalModel] = useState<string>((providers.local_model as string) ?? '');
  const [localBaseUrl, setLocalBaseUrl] = useState<string>((providers.local_base_url as string) ?? 'http://localhost:11434');
  const [budgetDaily, setBudgetDaily] = useState<number>((cfg.budget_daily_usd as number) ?? 5.0);
  const [saved, setSaved] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // Save title if changed
    if (title !== session.title) {
      updateQuery.mutate({ id: sessionId, title });
    }
    const config: Record<string, unknown> = {
      model,
      max_thread_depth: maxDepth,
      min_searches_per_thread: minSearches,
      fetch_source_text: fetchSourceText,
      budget_daily_usd: budgetDaily,
      gap_analysis: { enabled: gapEnabled, max_gap_searches: maxGapSearches },
      providers: {
        primary: provider,
        ...(provider === 'openrouter' ? {
          openrouter_api_key: openrouterKey || undefined,
          openrouter_models: openrouterModels.split(',').map(s => s.trim()).filter(Boolean),
        } : {}),
        ...(provider === 'ollama' ? {
          local_model: localModel,
          local_base_url: localBaseUrl,
        } : {}),
      },
    };
    updateConfig.mutate({ id: sessionId, config }, {
      onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000); },
    });
  }

  const inputCls = 'bg-bg-primary border border-border-primary rounded px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent w-full';
  const labelCls = 'block text-xs text-text-muted mb-1';

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-lg">
      {/* Env errors */}
      {envCheck && envCheck.errors.length > 0 && (
        <div className="rounded border border-red-500/50 bg-red-500/10 p-3 space-y-1">
          {envCheck.errors.map((e, i) => (
            <p key={i} className="text-xs text-red-400 flex items-start gap-1.5 font-medium">
              <Icon name="close" size="xs" className="mt-0.5 shrink-0" />{e}
            </p>
          ))}
        </div>
      )}
      {envCheck && envCheck.warnings.length > 0 && (
        <div className="rounded border border-yellow-500/30 bg-yellow-500/10 p-3 space-y-1">
          {envCheck.warnings.map((w, i) => (
            <p key={i} className="text-xs text-yellow-400 flex items-start gap-1.5">
              <span className="mt-0.5 shrink-0">&#x26a0;</span>{w}
            </p>
          ))}
        </div>
      )}

      {/* Title */}
      <div>
        <label className={labelCls}>Query title</label>
        <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} />
      </div>

      {/* Provider */}
      <div>
        <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Provider</p>
        <div className="flex gap-2 mb-4">
          {(['anthropic', 'openrouter', 'ollama'] as const).map(p => (
            <button key={p} type="button"
              onClick={() => setProvider(p)}
              className={clsx('px-3 py-1.5 rounded text-sm font-medium transition-colors',
                provider === p ? 'bg-accent text-white' : 'bg-bg-secondary border border-border-primary text-text-secondary hover:border-border-secondary')}>
              {p === 'anthropic' ? 'Anthropic' : p === 'openrouter' ? 'OpenRouter' : 'Local (Ollama)'}
            </button>
          ))}
        </div>

        {provider === 'anthropic' && (
          <div>
            <label className={labelCls}>Model</label>
            <input value={model} onChange={e => setModel(e.target.value)} placeholder="claude-sonnet-4-6" className={inputCls} />
            <div className="mt-1.5">
              {envCheck
                ? <EnvBadge set={envCheck.anthropic} label="ANTHROPIC_API_KEY" />
                : <span className="text-xs text-text-muted/60">Uses ANTHROPIC_API_KEY env var</span>}
            </div>
          </div>
        )}

        {provider === 'openrouter' && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>API Key (optional)</label>
              <input type="password" value={openrouterKey} onChange={e => setOpenrouterKey(e.target.value)} placeholder="sk-or-..." className={inputCls} />
              {envCheck && !openrouterKey && (
                <div className="mt-1.5">
                  <EnvBadge set={envCheck.openrouter} label="OPENROUTER_API_KEY" />
                </div>
              )}
            </div>
            <div>
              <label className={labelCls}>Models (comma-separated, rotated)</label>
              <input value={openrouterModels} onChange={e => setOpenrouterModels(e.target.value)}
                placeholder="deepseek/deepseek-chat, google/gemini-2.0-flash-001" className={inputCls} />
            </div>
          </div>
        )}

        {provider === 'ollama' && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Model</label>
              <input value={localModel} onChange={e => setLocalModel(e.target.value)} placeholder="qwen2.5:7b" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Base URL</label>
              <input value={localBaseUrl} onChange={e => setLocalBaseUrl(e.target.value)} className={inputCls} />
            </div>
          </div>
        )}
      </div>

      {/* Search */}
      <div>
        <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Search</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Max thread depth</label>
            <input type="number" min={1} max={20} value={maxDepth} onChange={e => setMaxDepth(Number(e.target.value))} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Min searches per thread</label>
            <input type="number" min={1} max={10} value={minSearches} onChange={e => setMinSearches(Number(e.target.value))} className={inputCls} />
          </div>
        </div>
      </div>

      {/* Source text */}
      <div>
        <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Source Text</p>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={fetchSourceText} onChange={e => setFetchSourceText(e.target.checked)}
            className="w-4 h-4 accent-accent mt-0.5" />
          <div>
            <span className="text-sm text-text-primary">Fetch source page text</span>
            <div className="mt-1 flex flex-col gap-1">
              {envCheck ? (
                <>
                  <span className="text-xs text-text-muted">Page extractor: {' '}
                    <EnvBadge set={envCheck.jina} label={envCheck.jina ? 'Jina (active)' : 'JINA_API_KEY'} />
                    {!envCheck.jina && <span className="text-xs text-red-400 ml-1 font-medium">-- will throw, no fallback</span>}
                  </span>
                  <span className="text-xs text-text-muted">Search: {' '}
                    {envCheck.searchProvider === 'tavily' && <EnvBadge set={true} label="Tavily (active)" />}
                    {envCheck.searchProvider === 'brave' && <EnvBadge set={true} label="Brave (active)" />}
                    {envCheck.searchProvider === 'duckduckgo' && (
                      <><EnvBadge set={false} label="TAVILY_API_KEY" /><span className="text-xs text-text-muted ml-1">-- falling back to DuckDuckGo</span></>
                    )}
                  </span>
                </>
              ) : (
                <span className="text-xs text-text-muted">requires JINA_API_KEY -- no fallback</span>
              )}
            </div>
          </div>
        </label>
      </div>

      {/* Gap analysis */}
      <div>
        <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Gap Analysis</p>
        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={gapEnabled} onChange={e => setGapEnabled(e.target.checked)}
              className="w-4 h-4 accent-accent" />
            <span className="text-sm text-text-primary">Enabled</span>
            <span className="text-xs text-text-muted">(runs a second LLM pass to find missing information)</span>
          </label>
          {gapEnabled && (
            <div className="max-w-[160px]">
              <label className={labelCls}>Max gap searches</label>
              <input type="number" min={1} max={5} value={maxGapSearches} onChange={e => setMaxGapSearches(Number(e.target.value))} className={inputCls} />
            </div>
          )}
        </div>
      </div>

      {/* Budget */}
      <div>
        <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Budget</p>
        <div className="max-w-[160px]">
          <label className={labelCls}>Daily limit (USD)</label>
          <input type="number" min={0} step={0.5} value={budgetDaily} onChange={e => setBudgetDaily(Number(e.target.value))} className={inputCls} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={updateConfig.isPending}>Save</Button>
        {saved && <span className="text-xs text-green-400">Saved</span>}
      </div>

      {/* Delete */}
      <div className="pt-4 border-t border-border-primary">
        {deleteConfirm ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Delete this query permanently?</span>
            <Button variant="ghost" size="sm" className="!bg-red-900/50 !text-red-300 hover:!bg-red-900/80"
              onClick={onDelete}>Confirm delete</Button>
            <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="!text-red-400 hover:!text-red-300"
            onClick={() => setDeleteConfirm(true)}>Delete query</Button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function ResearchQueryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session, isLoading, isError } = useResearchQuery(id!);
  const { data: runningData } = useResearchRunning(id!);
  const isRunning = runningData?.running ?? false;
  const { data: findingsData = [] } = useResearchFindings(id!);
  const { data: threadsData = [] } = useResearchThreads(id!);
  const { data: costs } = useResearchCosts(id!);
  const { data: activity } = useResearchActivity(id!, { refetchInterval: isRunning ? 3000 : undefined });
  const { data: allSteps = [] } = useResearchSteps(id!, undefined, { refetchInterval: isRunning ? 3000 : undefined });
  const { events } = useResearchStream(id!);
  const { data: envCheck } = useResearchEnvCheck();
  const { data: jobs = [] } = useResearchJobs(id!);
  const updateQuery = useUpdateResearchQuery();
  const updateConfig = useUpdateQueryConfig();
  const runResearch = useRunResearch();
  const cancelJob = useCancelJob();
  const deleteQuery = useDeleteResearchQuery();

  const [tab, setTab] = useState<'document' | 'live' | 'map' | 'settings'>('document');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [runIterations, setRunIterations] = useState<string>('');

  const findingCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of findingsData) map.set(f.thread_id, (map.get(f.thread_id) ?? 0) + 1);
    return map;
  }, [findingsData]);

  // Cross-navigation helpers
  const navigateToThread = useCallback((threadId: string) => {
    setSelectedThreadId(threadId);
    setTab('live');
  }, []);

  const navigateToMap = useCallback((threadId: string) => {
    setSelectedThreadId(threadId);
    setTab('map');
  }, []);

  const navigateToDocument = useCallback((threadId: string) => {
    setSelectedThreadId(threadId);
    setTab('document');
  }, []);

  if (isLoading) return <PageLoading />;
  if (isError || !session) return <ErrorState message="Query not found." />;

  const sessionFetchText = (session.config as Record<string, unknown>).fetch_source_text as boolean ?? false;
  function handleToggleSessionFetch() {
    updateConfig.mutate({ id: id!, config: { fetch_source_text: !sessionFetchText } });
  }

  const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'claimed');

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Left Sidebar — Thread Navigator (hidden on document tab) */}
      {tab !== 'document' && (
        <div className="w-[280px] shrink-0 border-r border-border-primary bg-bg-secondary/50 overflow-hidden flex flex-col">
          <ThreadNavigator
            threads={threadsData}
            findingCounts={findingCounts}
            selectedThreadId={selectedThreadId}
            onSelectThread={(id) => {
              setSelectedThreadId(id);
            }}
            sessionId={id!}
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Header bar */}
        <div className="px-6 py-4 border-b border-border-primary bg-bg-primary shrink-0">
          {/* Breadcrumb */}
          <Link to="/research/queries" className="text-xs text-accent hover:underline">&larr; All queries</Link>

          {/* Title + controls */}
          <div className="flex items-center justify-between mt-2">
            <div className="min-w-0">
              <h1 className="font-heading text-2xl font-bold text-text-primary truncate">{session.title}</h1>
              <p className="text-sm text-text-muted mt-0.5 truncate">{session.seed_query}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-4">
              {(session.status === 'active' || session.status === 'paused') && (
                <Button
                  variant={session.status === 'active' ? 'secondary' : 'primary'}
                  size="sm"
                  loading={updateQuery.isPending}
                  onClick={() => updateQuery.mutate({ id: id!, status: session.status === 'active' ? 'paused' : 'active' })}
                >
                  {session.status === 'active' ? 'Disable' : 'Enable'}
                </Button>
              )}
              {deleteConfirm ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-text-muted">Delete?</span>
                  <Button variant="ghost" size="sm" className="!bg-red-900/50 !text-red-300 hover:!bg-red-900/80"
                    loading={deleteQuery.isPending}
                    onClick={() => deleteQuery.mutate({ id: id! }, { onSuccess: () => { window.location.href = '/research/queries'; } })}
                  >Confirm</Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" className="!text-red-400 hover:!text-red-300"
                  onClick={() => setDeleteConfirm(true)}>Delete</Button>
              )}
            </div>
          </div>

          {/* Env warnings */}
          {envCheck && (envCheck.errors.length > 0 || envCheck.warnings.length > 0 || envCheck.jina_balance !== null) && (
            <div className="flex flex-col gap-1.5 mt-3">
              {envCheck.errors.map((e, i) => (
                <div key={i} className="rounded border border-red-500/50 bg-red-500/10 px-3 py-1.5 flex items-center gap-2">
                  <Icon name="close" size="xs" className="text-red-400 shrink-0" />
                  <span className="text-xs text-red-400 font-medium">{e}</span>
                </div>
              ))}
              {envCheck.warnings.map((w, i) => (
                <div key={i} className="rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 flex items-center gap-2">
                  <span className="text-yellow-400 text-xs shrink-0">&#x26a0;</span>
                  <span className="text-xs text-yellow-400">{w}</span>
                </div>
              ))}
              {envCheck.jina_balance !== null && (
                <div className="rounded border border-border-primary bg-bg-secondary px-3 py-1.5 flex items-center gap-2">
                  <span className="text-xs text-text-muted">Jina balance:</span>
                  <span className={`text-xs font-medium tabular-nums ${envCheck.jina_balance < 100_000 ? 'text-red-400' : envCheck.jina_balance < 1_000_000 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {envCheck.jina_balance.toLocaleString()} tokens
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-6 mt-3">
            {[
              { label: 'Findings', value: findingsData.length },
              { label: 'Threads', value: threadsData.length },
              { label: 'Cost', value: costs ? `$${costs.total_cost.toFixed(3)}` : '...' },
              { label: 'Today', value: costs ? `$${costs.today_cost.toFixed(3)}` : '...' },
            ].map(stat => (
              <div key={stat.label} className="flex items-center gap-1.5">
                <span className="text-xs text-text-muted">{stat.label}:</span>
                <span className="text-sm font-semibold text-text-primary tabular-nums">{stat.value}</span>
              </div>
            ))}
          </div>

          {/* Run controls */}
          <div className="flex items-center gap-2 mt-3">
            <Button
              size="sm"
              loading={runResearch.isPending}
              onClick={() => {
                const iters = runIterations.trim() ? parseInt(runIterations, 10) : undefined;
                runResearch.mutate({ sessionId: id!, iterations: iters });
              }}
            >Run</Button>
            <input
              type="number"
              min={1}
              value={runIterations}
              onChange={e => setRunIterations(e.target.value)}
              placeholder="N"
              className="w-16 bg-bg-secondary border border-border-primary rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent"
              title="Number of iterations (blank = default)"
            />
            {activeJobs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="!text-red-400 hover:!text-red-300"
                onClick={() => { for (const j of activeJobs) cancelJob.mutate({ jobId: j.id }); }}
              >Cancel</Button>
            )}
            {isRunning && (
              <span className="flex items-center gap-1.5 ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                <span className="text-xs text-success">Running</span>
              </span>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 mt-3 -mb-[17px]">
            {([
              { key: 'document' as const, label: `Document (${findingsData.length})` },
              { key: 'live' as const, label: `Live (${threadsData.length})` },
              { key: 'map' as const, label: `Map` },
              { key: 'settings' as const, label: 'Settings' },
            ]).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={clsx('px-3 py-2 text-sm font-medium border-b-2 transition-colors',
                  tab === t.key ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-secondary')}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === 'document' && (
            <DocumentView
              findings={findingsData}
              threads={threadsData}
              onNavigateToThread={navigateToThread}
              onNavigateToMap={navigateToMap}
              document={session?.document || undefined}
              sessionId={id!}
            />
          )}
          {tab === 'live' && (
            <LiveView
              threads={threadsData}
              findings={findingsData}
              allSteps={allSteps}
              events={events}
              isRunning={isRunning}
              sessionId={id!}
              sessionFetchText={sessionFetchText}
              onToggleSessionFetch={handleToggleSessionFetch}
              activity={activity}
              jobs={jobs}
              selectedThreadId={selectedThreadId}
              onSelectThread={setSelectedThreadId}
              onNavigateToDocument={navigateToDocument}
              onNavigateToMap={navigateToMap}
            />
          )}
          {tab === 'map' && (
            <MapView
              threads={threadsData}
              findingCounts={findingCounts}
              onNavigateToLive={navigateToThread}
            />
          )}
          {tab === 'settings' && (
            <SettingsView
              session={session}
              sessionId={id!}
              onDelete={() => deleteQuery.mutate({ id: id! }, { onSuccess: () => { window.location.href = '/research/queries'; } })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
