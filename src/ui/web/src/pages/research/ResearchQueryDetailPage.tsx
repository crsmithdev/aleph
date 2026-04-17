import { Icon } from '../../components/ui/Icon';
import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
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
  useGenerateDocument, useResearchWorkers, useResearchDefaults,
  useConcepts, useConceptLinks, useConceptDetail,
  useSources, useRetrySource, useSkipSource,
  type ResearchFinding, type ResearchThread, type ResearchActivity,
  type ResearchJob, type StreamEvent, type ResearchStep,
  type ConceptWithStats,
  type Source, type SourceExtractionStatus,
} from '../../api/research-hooks';
import { Button } from '../../components/ui/Button';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { ConfigForm, patchByPath, getByPath } from './config-schema';
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
      <span className="text-sm text-text-muted">{label}</span>
      <div className="w-12 h-1 bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full', value > 0.7 ? 'bg-success' : value > 0.4 ? 'bg-warning' : 'bg-error')}
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <span className="text-sm text-text-muted">{(value * 100).toFixed(0)}%</span>
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
    <span className={clsx('px-1.5 py-0.5 rounded text-sm font-medium shrink-0', originBadgeCls[origin] ?? 'bg-bg-tertiary text-text-muted')}>
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
          <span className="text-sm text-text-muted uppercase tracking-wide font-medium">Threads</span>
          <span className="text-sm text-text-muted tabular-nums">{threads.length}</span>
        </div>
        <input
          type="text"
          aria-label="Filter threads"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter threads..."
          className="w-full bg-bg-primary border border-border-primary rounded px-2 py-1 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent"
        />
        <div className="flex gap-1">
          {(['hierarchical', 'flat'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={clsx('flex-1 px-2 py-1 rounded text-sm transition-colors',
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
          const display = thread.short_query ?? thread.query;
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
              <span className="text-sm text-text-primary truncate flex-1">{display}</span>
              {fc > 0 && (
                <span className="px-1 py-0.5 bg-bg-tertiary text-text-muted text-sm rounded shrink-0">{fc}</span>
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
            aria-label="Inject question"
            value={newQuestion}
            onChange={e => setNewQuestion(e.target.value)}
            placeholder="Inject question..."
            className="flex-1 bg-bg-primary border border-border-primary rounded px-2 py-1 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent"
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
// Document helpers
// ---------------------------------------------------------------------------

interface ParsedSection {
  headingTitle: string;
  headingId: string;
  headingLevel: number; // 0 = preamble, 2 or 3 = actual heading
  content: string;
  citationNums: Set<number>;
}

function parseDocumentSections(text: string): ParsedSection[] {
  const citRegex = /\[(\d+)\](?![\(\[])/g;
  const extractCitations = (s: string) =>
    new Set([...s.matchAll(citRegex)].map(m => parseInt(m[1])));

  const parts = text.split(/(?=^#{2,3} )/m);
  const sections: ParsedSection[] = [];

  for (const part of parts) {
    const m = part.match(/^(#{2,3}) (.+?)(?:\r?\n|$)([\s\S]*)/);
    if (m) {
      const title = m[2].trim();
      const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      sections.push({
        headingTitle: title,
        headingId: id,
        headingLevel: m[1].length,
        content: m[3] ?? '',
        citationNums: extractCitations(part),
      });
    } else if (part.trim()) {
      sections.push({ headingTitle: '', headingId: '', headingLevel: 0, content: part, citationNums: extractCitations(part) });
    }
  }
  return sections;
}

/** Replace bare [N] citations with markdown links pointing to #ref-N */
function addCitationLinks(text: string): string {
  return text.replace(/\[(\d+)\](?![\(\[])/g, (_, n) => `[[${n}]](#ref-${n})`);
}

// ---------------------------------------------------------------------------
// Section metadata panel (sources · tags · questions)
// ---------------------------------------------------------------------------

function SectionMetaPanel({
  citationNums, sortedFindings, threadById,
}: {
  citationNums: Set<number>;
  sortedFindings: ResearchFinding[];
  threadById: Map<string, ResearchThread>;
}) {
  const [open, setOpen] = useState(false);

  const sectionFindings = useMemo(
    () => [...citationNums].sort((a, b) => a - b).map(n => sortedFindings[n - 1]).filter(Boolean),
    [citationNums, sortedFindings],
  );
  if (sectionFindings.length === 0) return null;

  const uniqueSources = useMemo(() => {
    const all = sectionFindings.flatMap(f =>
      f.source_url_meta?.length
        ? f.source_url_meta
        : f.source_urls.map(url => ({ url, title: '', snippet: '' }))
    );
    return [...new Map(all.map(s => [s.url, s])).values()];
  }, [sectionFindings]);

  const allTags = useMemo(
    () => [...new Set(sectionFindings.flatMap(f => f.tags))],
    [sectionFindings],
  );

  const questions = useMemo(
    () => [...new Set(
      sectionFindings.map(f => {
        const t = threadById.get(f.thread_id);
        return t?.short_query ?? t?.query ?? '';
      }).filter(Boolean)
    )],
    [sectionFindings, threadById],
  );

  const citLabel = [...citationNums].sort((a, b) => a - b).join(', ');

  return (
    <div className="my-3 rounded border border-border-primary/20 text-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-bg-secondary/40 hover:bg-bg-tertiary/30 transition-colors text-left"
      >
        <Icon name="expand_more" size="xs" className={clsx('text-text-muted/60 transition-transform flex-none leading-none', !open && '-rotate-90')} />
        <span className="text-text-muted/70">
          {sectionFindings.length} {sectionFindings.length === 1 ? 'source' : 'sources'}
          {allTags.length > 0 && <span className="text-text-disabled"> · {allTags.slice(0, 3).join(', ')}</span>}
        </span>
        <span className="ml-auto text-text-disabled font-mono">[{citLabel}]</span>
      </button>

      {open && (
        <div className="px-3 py-2.5 space-y-3 bg-bg-primary/20 border-t border-border-primary/20">
          {uniqueSources.length > 0 && (
            <div>
              <p className="text-text-disabled uppercase tracking-wide text-sm mb-1 font-medium">Sources</p>
              <div className="space-y-0.5">
                {uniqueSources.map((src, i) => (
                  <a key={i} href={src.url} target="_blank" rel="noopener noreferrer"
                     className="block text-accent/75 hover:text-accent hover:underline truncate" title={src.url}>
                    {src.title || src.url}
                  </a>
                ))}
              </div>
            </div>
          )}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {allTags.map(tag => (
                <span key={tag} className="px-1.5 py-0.5 rounded bg-bg-tertiary/70 text-text-muted">{tag}</span>
              ))}
            </div>
          )}
          {questions.length > 0 && (
            <div>
              <p className="text-text-disabled uppercase tracking-wide text-sm mb-1 font-medium">Questions</p>
              <ul className="space-y-0.5">
                {questions.map((q, i) => (
                  <li key={i} className="text-text-muted italic leading-relaxed">{q}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Document Tab
// ---------------------------------------------------------------------------

function DocumentView({
  findings, threads, onNavigateToThread, onNavigateToMap, document, sessionId, title,
}: {
  findings: ResearchFinding[];
  threads: ResearchThread[];
  onNavigateToThread: (threadId: string) => void;
  onNavigateToMap: (threadId: string) => void;
  document?: string;
  sessionId: string;
  title?: string;
}) {
  const generateDoc = useGenerateDocument();

  const hasFindings = findings.length >= 3;

  // Strip markdown code fences if present
  const cleanDoc = useMemo(() => {
    if (!document) return '';
    return document.replace(/^```(?:markdown)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
  }, [document]);

  function exportMarkdown() {
    if (!cleanDoc) return;
    const blob = new Blob([cleanDoc], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${(title || sessionId).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Parse document into sections for per-section metadata + TOC
  const docSections = useMemo(() => parseDocumentSections(cleanDoc), [cleanDoc]);

  // Sorted findings for citation index lookup (1-based)
  const sortedFindings = useMemo(
    () => [...findings].sort((a, b) => b.confidence - a.confidence),
    [findings],
  );

  const threadById = useMemo(() => new Map(threads.map(t => [t.id, t])), [threads]);

  const tocEntries = useMemo(
    () => docSections.filter(s => s.headingLevel >= 2).map(s => ({ id: s.headingId, title: s.headingTitle, level: s.headingLevel })),
    [docSections],
  );

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

  const sortedFindingsForBib = useMemo(
    () => [...findings].sort((a, b) => b.confidence - a.confidence),
    [findings],
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[200px_minmax(0,1fr)_300px] gap-7">
      {/* Left TOC rail */}
      {tocEntries.length > 2 ? (
        <aside className="hidden xl:block">
          <div className="sticky top-4 space-y-0.5">
            <h4 className="text-sm text-text-muted uppercase tracking-[0.08em] mb-2.5 font-medium">Contents</h4>
            <ul className="list-none p-0 m-0">
              {tocEntries.map((entry, idx) => (
                <li key={idx}>
                  <button
                    onClick={() => scrollToHeading(entry.id)}
                    className={clsx(
                      'block w-full text-left py-1 text-sm hover:text-text-primary hover:bg-bg-tertiary/30 rounded truncate transition-colors',
                      entry.level === 2 ? 'px-2 text-text-secondary' : 'pl-4 pr-2 text-text-muted text-sm',
                    )}
                  >
                    {entry.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      ) : <div className="hidden xl:block" />}

      {/* Center: article */}
      <div className="min-w-0">
        <div className="max-w-[720px] mx-auto">
          {/* Regenerate / Export controls */}
          <div className="flex items-center justify-end mb-6 gap-2">
            <Button variant="ghost" size="sm" onClick={exportMarkdown}>
              <Icon name="download" size="xs" className="mr-1" />
              Export .md
            </Button>
            <Button variant="ghost" size="sm" onClick={() => generateDoc.mutate({ sessionId })} loading={generateDoc.isPending}>
              <Icon name="refresh" size="xs" className="mr-1" />
              Regenerate
            </Button>
          </div>

          <article className="md-content article-view text-base text-text-primary leading-[1.7]">
            {docSections.map((section, idx) => {
              const mdComponents = {
                p: ({ children }: React.HTMLAttributes<HTMLParagraphElement>) => <p className="mb-4 text-text-secondary">{children}</p>,
                a: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
                  const isInternal = href?.startsWith('#ref-');
                  return (
                    <a
                      {...rest}
                      href={href}
                      {...(!isInternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      onClick={isInternal ? (e) => {
                        e.preventDefault();
                        const el = window.document.getElementById(href!.slice(1));
                        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      } : undefined}
                      className={clsx('hover:underline', isInternal ? 'text-text-muted text-sm font-mono' : 'text-accent')}
                    >
                      {children}
                    </a>
                  );
                },
                blockquote: ({ children }: React.HTMLAttributes<HTMLElement>) => (
                  <blockquote className="border-l-[3px] border-accent/30 pl-4 my-4 text-text-muted italic">{children}</blockquote>
                ),
                ol: ({ children }: React.HTMLAttributes<HTMLOListElement>) => <ol className="list-decimal pl-6 mb-4 space-y-1 text-text-secondary">{children}</ol>,
                ul: ({ children }: React.HTMLAttributes<HTMLUListElement>) => <ul className="list-disc pl-6 mb-4 space-y-1 text-text-secondary">{children}</ul>,
              };

              return (
                <div key={idx}>
                  {section.headingLevel === 2 && (
                    <h2 id={section.headingId} className="font-heading text-xl font-semibold text-text-primary mt-10 mb-4 pb-2 border-b border-border-primary/30">
                      {section.headingTitle}
                    </h2>
                  )}
                  {section.headingLevel === 3 && (
                    <h3 id={section.headingId} className="font-heading text-lg font-medium text-text-primary mt-8 mb-3">
                      {section.headingTitle}
                    </h3>
                  )}
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {addCitationLinks(section.content)}
                  </ReactMarkdown>
                  {section.citationNums.size > 0 && (
                    <SectionMetaPanel
                      citationNums={section.citationNums}
                      sortedFindings={sortedFindings}
                      threadById={threadById}
                    />
                  )}
                </div>
              );
            })}
          </article>
        </div>
      </div>

      {/* Right bibliography rail */}
      <aside className="hidden xl:block">
        <div className="sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
          <BibliographyRail findings={sortedFindingsForBib} sessionId={sessionId} />
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bibliography rail (right side of Document view)
// ---------------------------------------------------------------------------

function domainFrom(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function extractionPillClass(status: SourceExtractionStatus): string {
  switch (status) {
    case 'extracted':
      return 'bg-success/15 text-success border-success/30';
    case 'failed':
      return 'bg-error/15 text-error border-error/30';
    case 'skipped':
      return 'bg-bg-tertiary text-text-muted border-border-primary/30';
    case 'pending':
    case 'claimed':
    default:
      return 'bg-warning/15 text-warning border-warning/30';
  }
}

function extractionPillLabel(status: SourceExtractionStatus): string {
  if (status === 'claimed') return 'extracting';
  return status;
}

function BibliographyRail({
  findings,
  sessionId,
}: {
  findings: ResearchFinding[];
  sessionId: string;
}) {
  const { data: sourcesData } = useSources(sessionId);
  const sourceByUrl = useMemo(() => {
    const m = new Map<string, Source>();
    for (const s of sourcesData?.items ?? []) m.set(s.url, s);
    return m;
  }, [sourcesData]);

  const items = useMemo(() => {
    return findings.map((f, i) => {
      const urls = f.source_url_meta?.length
        ? f.source_url_meta.map(s => s.url)
        : f.source_urls;
      const primaryUrl = urls[0];
      const primarySource = primaryUrl ? sourceByUrl.get(primaryUrl) : undefined;
      const domain = primaryUrl ? domainFrom(primaryUrl) : '';
      const title = f.source_url_meta?.[0]?.title || f.summary;
      return {
        index: i + 1,
        finding: f,
        title,
        href: primaryUrl,
        domain,
        status: primarySource?.extraction_status as SourceExtractionStatus | undefined,
      };
    });
  }, [findings, sourceByUrl]);

  return (
    <div>
      <h4 className="text-sm text-text-muted font-medium uppercase tracking-[0.08em] mb-2.5">
        References &middot; {items.length}
      </h4>
      <div>
        {items.map(({ index, finding, title, href, domain, status }) => (
          <div
            key={finding.id}
            id={`ref-${index}`}
            className="py-2.5 border-b border-border-primary/30 last:border-b-0"
          >
            <span className="text-accent font-mono text-sm mr-1.5">[{index}]</span>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-primary text-sm leading-snug hover:underline"
              >
                {title}
              </a>
            ) : (
              <span className="text-text-primary text-sm leading-snug">{title}</span>
            )}
            {(domain || finding.confidence > 0) && (
              <div className="text-sm text-text-muted mt-0.5">
                {domain}
                {domain && <span className="mx-1">&middot;</span>}
                <span>{(finding.confidence * 100).toFixed(0)}% conf</span>
              </div>
            )}
            {status && (
              <div className="mt-1">
                <span
                  className={clsx(
                    'inline-flex items-center text-sm px-2 py-[1px] border rounded',
                    extractionPillClass(status),
                  )}
                >
                  {extractionPillLabel(status)}
                </span>
              </div>
            )}
          </div>
        ))}
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

  const displayText = thread.short_query ?? thread.query;
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
              <span className="text-sm font-mono text-accent/70">{workerLabel}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base text-text-primary leading-snug">
                {displayText}
              </span>
              <OriginBadge origin={thread.origin} />
              {thread.priority !== undefined && (
                <span className="text-sm text-text-muted font-mono shrink-0">p:{thread.priority.toFixed(2)}</span>
              )}
              {thread.status === 'exhausted' && threadFindings.length > 0 && (
                <span className="text-sm text-text-muted shrink-0">{threadFindings.length} finding{threadFindings.length !== 1 ? 's' : ''}</span>
              )}
              {thread.status === 'active' && (
                <span className="text-sm text-success shrink-0">running...</span>
              )}
              {threadFetch !== null && (
                <span className={clsx('px-1 py-0.5 rounded text-sm shrink-0 font-mono',
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
            className={clsx('p-1 rounded text-sm', showInlineConfig ? 'text-accent' : 'text-text-muted hover:text-text-primary')}
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
              className="p-1 text-text-muted hover:text-red-400 rounded text-sm"
            ><Icon name="close" size="xs" /></button>
          )}
        </div>
      </div>

      {/* Inline config panel */}
      {showInlineConfig && (
        <div className="ml-5 pl-3 border-l border-accent/30 py-2 mb-1 bg-bg-secondary/50 rounded-r-lg space-y-2">
          <div className="flex items-center gap-4 text-sm text-text-muted">
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
            <span className="text-sm text-text-muted font-mono w-8">{thread.priority.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <span className="text-sm text-text-muted">Fetch source text:</span>
            <button
              onClick={handleFetchToggle}
              className={clsx('px-2 py-0.5 rounded text-sm border transition-colors',
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
                className="px-1.5 py-0.5 text-text-muted hover:text-blue-400 rounded text-sm border border-border-primary hover:border-blue-700/40"
              >redo</button>
            )}
            {isTerminal && (
              <button
                onClick={() => redoThread.mutate({ sessionId, threadId: thread.id, fetch_source_text: true })}
                disabled={redoThread.isPending}
                className="px-1.5 py-0.5 text-text-muted hover:text-green-400 rounded text-sm border border-border-primary hover:border-green-700/40 font-mono"
              >redo+txt</button>
            )}
          </div>
          <div className="text-sm text-text-muted/60 space-y-0.5">
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
              className={clsx('px-1.5 py-0.5 rounded text-sm border transition-colors',
                threadFetch === true ? 'bg-green-900/40 border-green-700/40 text-green-400 hover:bg-green-900/60'
                  : threadFetch === false ? 'bg-red-900/30 border-red-700/30 text-red-400/70 hover:bg-red-900/50'
                    : 'bg-bg-secondary border-border-primary text-text-muted/50 hover:text-text-muted'
              )}
            >txt</button>
            {isTerminal && (
              <button
                onClick={() => redoThread.mutate({ sessionId, threadId: thread.id })}
                disabled={redoThread.isPending}
                className="px-1.5 py-0.5 text-text-muted hover:text-blue-400 rounded text-sm border border-border-primary hover:border-blue-700/40"
              >&#x21ba; redo</button>
            )}
            {isTerminal && (
              <button
                onClick={() => redoThread.mutate({ sessionId, threadId: thread.id, fetch_source_text: true })}
                disabled={redoThread.isPending}
                className="px-1.5 py-0.5 text-text-muted hover:text-green-400 rounded text-sm border border-border-primary hover:border-green-700/40 font-mono"
              >&#x21ba; redo+txt</button>
            )}
          </div>

          {/* Thread metadata */}
          <div className="flex items-center gap-3 py-0.5 text-sm text-text-secondary">
            <span>created {new Date(thread.created_at).toLocaleTimeString()}</span>
            <span>depth {thread.depth}/{thread.max_depth}</span>
            {thread.id && <span className="font-mono">{thread.id}</span>}
          </div>

          {/* Perturbation info */}
          {thread.origin === 'perturbation' && thread.perturbation_strategy && (
            <div className="py-1 px-2 bg-orange-900/10 border border-orange-800/30 rounded text-sm space-y-0.5">
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
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <span className="text-blue-400/80 font-mono shrink-0">llm</span>
                <span className="font-mono">{step.model}</span>
                <span className="text-text-muted/70">{step.prompt_tokens + step.completion_tokens}</span>
                {step.cost_usd > 0 && <span className="text-text-muted/70">${step.cost_usd.toFixed(4)}</span>}
                {step.duration_ms && <span className="text-text-muted/70">{(step.duration_ms / 1000).toFixed(1)}s</span>}
                <span className="text-text-muted/40 ml-auto">{new Date(step.created_at).toLocaleTimeString()}</span>
              </div>
              {step.error && (
                <div className="flex items-start gap-1.5 pl-4">
                  <span className="text-red-400 text-sm shrink-0">error:</span>
                  <span className="text-sm text-red-300 break-words">{step.error}</span>
                </div>
              )}
              {step.tool_calls.length === 0 && step.label && (
                <span className="pl-4 text-sm text-text-muted/70 italic">{step.label}</span>
              )}
              {step.tool_calls.length === 0 && !step.label && !step.error && (
                <span className="pl-4 text-sm text-text-muted/40 italic">no tool calls</span>
              )}
              {step.tool_calls.map((tc, ti) => (
                <div key={`${si}-${ti}`} className="pl-4 space-y-0.5">
                  <div className="flex items-start gap-2">
                    <span className="text-text-secondary/80 text-sm font-mono shrink-0">{tc.tool}</span>
                    {tc.input && (
                      <span className="text-sm text-text-primary break-words flex-1">
                        {tc.tool === 'web_search' && tc.input.query
                          ? <span className="text-text-primary">"{tc.input.query as string}"</span>
                          : <span className="text-text-secondary/70 text-sm">{JSON.stringify(tc.input).slice(0, 120)}</span>}
                      </span>
                    )}
                    {tc.error && (
                      <span className="flex items-center gap-0.5 text-sm text-red-400 shrink-0" title={tc.error}><Icon name="close" size="xs" /> error</span>
                    )}
                  </div>
                  {tc.jina_fetches && tc.jina_fetches.length > 0 && (
                    <div className="pl-4 space-y-0.5">
                      {tc.jina_fetches.map((jf, ji) => {
                        let hostname = jf.url;
                        try { hostname = new URL(jf.url).hostname; } catch { /* keep url */ }
                        return (
                          <div key={ji} className="flex items-center gap-2">
                            <span className={clsx('text-sm shrink-0', jf.ok ? 'text-green-400' : 'text-red-400')}>
                              <Icon name={jf.ok ? 'check' : 'close'} size="xs" />
                            </span>
                            <a href={jf.url} target="_blank" rel="noreferrer"
                              className="text-sm text-accent hover:underline truncate max-w-[300px]">{hostname}</a>
                            {jf.ok
                              ? <span className="text-sm text-text-muted/60 shrink-0">{(jf.content_length / 1000).toFixed(1)}k</span>
                              : <span className="text-sm text-red-400/70 shrink-0" title={jf.error ?? 'fetch failed'}>{jf.error ?? 'failed'}</span>
                            }
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {tc.error && (
                    <div className="pl-4 text-sm text-red-400/80 break-words">{tc.error}</div>
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
                  <span className="text-sm text-text-muted" title="Confidence score">conf {(f.confidence * 100).toFixed(0)}%</span>
                  <span className="text-sm text-text-muted" title="Novelty score">novel {(f.novelty * 100).toFixed(0)}%</span>
                  <span className="text-sm text-text-muted" title="Actionability score">act {(f.actionability * 100).toFixed(0)}%</span>
                  {f.source_urls.length > 0 && <span className="text-sm text-text-muted">{f.source_urls.length} src</span>}
                  {f.source_texts.filter(t => t.length > 0).length > 0
                    ? <span className="text-sm text-green-400/70">{f.source_texts.filter(t => t.length > 0).length} full-text</span>
                    : f.source_urls.length > 0 && (
                      <button
                        title="Fetch full-text for this finding's sources"
                        onClick={() => fetchFindingText.mutate({ sessionId, findingId: f.id })}
                        disabled={fetchFindingText.isPending}
                        className="text-sm text-text-muted/50 hover:text-green-400 font-mono opacity-0 group-hover/finding:opacity-100 transition-opacity"
                      >&#x2193;txt</button>
                    )
                  }
                  {f.confidence < 0.4 && <span className="text-sm text-red-400">low confidence</span>}
                </div>
              </div>
            </div>
          ))}

          {/* Follow-up analysis */}
          {hasAnalysis && (
            <div className="mt-1.5 pt-1 border-t border-border-primary/30">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm text-text-muted uppercase tracking-wide">Follow-up analysis</p>
                {(threadFindings[0]?.follow_up_analysis?.retry_count ?? 0) > 0 && (
                  <span className="text-sm text-text-muted/60">{threadFindings[0]?.follow_up_analysis?.retry_count} retries</span>
                )}
                <span className="text-sm text-text-muted/60">threshold: {((threadFindings[0]?.follow_up_analysis?.similarity_threshold ?? 0.75) * 100).toFixed(0)}%</span>
              </div>
              {followUpCandidates.map((c, i) => {
                const spawned = childQuerySet.has((c.text ?? '').toLowerCase().trim());
                return (
                  <div key={i} className={clsx('py-0.5 px-1 rounded mb-0.5', c.accepted ? '' : 'opacity-50')}>
                    <div className="flex items-start gap-1.5">
                      <span className={clsx('text-sm shrink-0 mt-0.5', c.accepted ? 'text-purple-400' : 'text-text-muted')}>
                        {c.accepted ? (spawned ? <Icon name="arrow_forward" size="xs" /> : <span>&#xb7;</span>) : <Icon name="close" size="xs" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className={clsx('text-sm break-words', c.accepted ? (spawned ? 'text-text-secondary' : 'text-text-muted') : 'text-text-muted/50 line-through')}>{c.text}</span>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-sm text-text-muted/70" title="Quality score">quality:{(c.quality_score*100).toFixed(0)}%</span>
                          <span className="text-sm text-text-muted/70" title="Rank score">rank:{(c.rank_score*100).toFixed(0)}%</span>
                          <span className="text-sm text-text-muted/70" title="Distance from parent">dist:{(c.distance_from_parent*100).toFixed(0)}%</span>
                          {c.dedup_similarity > 0 && (
                            <span className={clsx('text-sm', c.dedup_similarity > (threadFindings[0]?.follow_up_analysis?.similarity_threshold ?? 0.75) ? 'text-red-400' : 'text-text-muted/70')}
                              title="Max similarity vs previously-accepted candidates (deduplication score)">
                              dedup:{(c.dedup_similarity*100).toFixed(0)}%
                            </span>
                          )}
                          {c.embedding_similarity !== null && c.embedding_similarity !== undefined && (
                            <span className="text-sm text-text-muted/70" title="Embedding similarity">emb:{(c.embedding_similarity*100).toFixed(0)}%</span>
                          )}
                          {c.llm_similarity !== null && c.llm_similarity !== undefined && (
                            <span className="text-sm text-text-muted/70" title="LLM similarity">llm:{(c.llm_similarity*100).toFixed(0)}%</span>
                          )}
                          {c.similarity_method !== 'jaccard' && (
                            <span className="text-sm text-accent/70 font-mono">[{c.similarity_method}]</span>
                          )}
                          {c.accepted && spawned && <span className="text-sm text-purple-400">spawned</span>}
                          {!c.accepted && c.rejection_reason && (
                            <span className="text-sm text-red-400/70 italic truncate max-w-[120px]" title={c.rejection_reason}>{c.rejection_reason}</span>
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
              <p className="text-sm text-text-muted uppercase tracking-wide mb-0.5">Follow-ups</p>
              {Array.from(new Set(threadFindings.flatMap(f => f.follow_ups ?? []))).map((q, i) => {
                const spawned = childQuerySet.has(q.toLowerCase().trim());
                return (
                  <div key={i} className="flex items-start gap-1.5 py-0.5">
                    <span className="text-sm text-text-muted shrink-0 mt-0.5">{spawned ? '\u2192' : '\u00b7'}</span>
                    <span className={clsx('text-sm break-words', spawned ? 'text-text-secondary' : 'text-text-muted')}>{q}</span>
                    {spawned && <span className="text-sm text-purple-400 shrink-0 mt-0.5">spawned</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Cross-nav links */}
          <div className="flex items-center gap-4 pt-1 border-t border-border-primary/20">
            <button onClick={onViewInDocument} className="text-sm text-accent hover:underline">
              View in document &rarr;
            </button>
            <button onClick={onShowOnMap} className="text-sm text-accent hover:underline">
              Show on map &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


const liveStatusDot: Record<string, string> = {
  active: 'bg-success animate-pulse',
  running: 'bg-success animate-pulse',
  queued: 'bg-warning/70',
  pending: 'bg-warning/40',
  exhausted: 'bg-text-disabled',
  pruned: 'bg-error/60',
  deferred: 'bg-text-muted/30',
};

const liveStatusBorder: Record<string, string> = {
  active: 'border-l-success',
  running: 'border-l-success',
  queued: 'border-l-warning/70',
  pending: 'border-l-warning/40',
  exhausted: 'border-l-text-disabled',
  pruned: 'border-l-error/60',
  deferred: 'border-l-text-muted/30',
};

const liveOriginColor: Record<string, string> = {
  seed: 'bg-accent/15 text-accent',
  gap_analysis: 'bg-purple-500/15 text-purple-400',
  follow_up: 'bg-blue-500/15 text-blue-400',
  perturbation: 'bg-orange-500/15 text-orange-400',
};

const THREAD_PALETTE = ['#c792ea', '#82aaff', '#c3e88d', '#89ddff', '#ffcb6b', '#f78c6c', '#f07178', '#b2ccd6'];
const RENDER_WINDOW = 500; // max DOM nodes in the event stream list

type Chip = { text: string; color: string; meta?: boolean };

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function stepChips(s: ResearchStep): Chip[] {
  const chips: Chip[] = [];
  const shortModel = s.model.includes('/') ? s.model.split('/').pop()! : s.model;
  chips.push({ text: shortModel, color: 'text-text-muted', meta: true });
  const tok = s.prompt_tokens + s.completion_tokens;
  if (tok > 0) chips.push({ text: fmtTokens(tok), color: 'text-text-muted', meta: true });
  if (s.cost_usd > 0) chips.push({ text: `$${s.cost_usd.toFixed(5)}`, color: 'text-text-muted', meta: true });
  // Outcome chips from metadata
  const m = s.metadata;
  if (m) {
    if (m.decision === 'gap_analysis') {
      const hasGaps = m.has_gaps as boolean;
      const gapCount = m.gap_count as number;
      const gapMax = m.gap_max as number | undefined;
      const gapText = hasGaps ? (gapMax != null ? `${gapCount}/${gapMax} gaps` : `${gapCount} gaps`) : 'no gaps';
      chips.push({ text: gapText, color: hasGaps ? 'text-warning' : 'text-text-muted' });
    } else if (m.decision === 'synthesis') {
      chips.push({ text: `conf ${((m.confidence as number) * 100).toFixed(0)}%`, color: 'text-success' });
      chips.push({ text: `nov ${((m.novelty as number) * 100).toFixed(0)}%`, color: 'text-blue-400' });
    } else if (m.decision === 'dedup') {
      const dup = m.is_duplicate as boolean;
      chips.push({ text: dup ? 'duplicate' : 'unique', color: dup ? 'text-error' : 'text-success' });
      chips.push({ text: `vs ${m.existing_count as number}`, color: 'text-text-muted' });
    } else if (m.decision === 'follow_up_eval') {
      chips.push({ text: `${m.accepted_count as number}✓`, color: 'text-success' });
      chips.push({ text: `${m.rejected_count as number}✗`, color: 'text-error/70' });
    } else if (m.decision === 'formulate_queries') {
      chips.push({ text: `${(m.queries as string[]).length} queries`, color: 'text-blue-400' });
    }
  }
  return chips;
}

function formatEventDetail(ev: StreamEvent & { threadDiff?: string }): { typeLabel: string; typeColor: string; detail: string; chips?: Chip[] } | null {
  if (ev.type === 'finding') {
    const f = ev.payload;
    const chips: Chip[] = [
      { text: `conf ${(f.confidence * 100).toFixed(0)}%`, color: f.confidence >= 0.7 ? 'text-success' : f.confidence >= 0.4 ? 'text-warning' : 'text-error' },
      { text: `nov ${(f.novelty * 100).toFixed(0)}%`, color: 'text-blue-400' },
    ];
    return {
      typeLabel: 'finding',
      typeColor: 'text-success',
      detail: (f.summary || f.content).slice(0, 100) + ((f.summary || f.content).length > 100 ? '…' : ''),
      chips,
    };
  }
  if (ev.type === 'thread') {
    const t = ev.payload;
    const diff = ev.threadDiff;
    const name = t.short_query ?? t.query;
    // Non-status changes (titled, priority, backoff, retry)
    if (diff && !diff.includes(' → ')) {
      if (diff === 'titled') return { typeLabel: 'named', typeColor: 'text-text-muted/70', detail: name };
      return { typeLabel: 'update', typeColor: 'text-text-muted', detail: `${name} · ${diff}` };
    }
    // Specific status transitions
    if (diff === 'paused → active') return { typeLabel: 'resume', typeColor: 'text-success/80', detail: name };
    const originTag = t.origin !== 'seed' ? ` [${t.origin.replace(/_/g, '·')} d${t.depth}]` : ` [d${t.depth}]`;
    if (t.status === 'active') return { typeLabel: 'start', typeColor: 'text-warning', detail: `${name}${originTag}` };
    if (t.status === 'queued') return { typeLabel: 'queue', typeColor: 'text-warning/70', detail: `${name}${originTag}` };
    if (t.status === 'pruned') return { typeLabel: 'prune', typeColor: 'text-error', detail: name };
    if (t.status === 'paused') return { typeLabel: 'pause', typeColor: 'text-warning/60', detail: name };
    if (t.status === 'exhausted') return { typeLabel: 'done', typeColor: 'text-text-muted', detail: name };
    if (t.status === 'deferred') return { typeLabel: 'defer', typeColor: 'text-text-muted', detail: `${name}${originTag}` };
    if (diff) return { typeLabel: 'update', typeColor: 'text-text-muted', detail: `${name} · ${diff}` };
    return null;
  }
  if (ev.type === 'step') {
    const s = ev.payload;
    const tools = s.tool_calls ?? [];
    const chips = stepChips(s);
    // No tools — label-only step (e.g. gap analysis, synthesis, dedup)
    if (tools.length === 0) {
      const labelAliases: Record<string, string> = {
        'synthesize finding': 'synthesis',
        'synthesize findings': 'synthesis',
        'evaluate follow-ups': 'followups',
        'summarize thread': 'summarize',
        'dedup check': 'dedup',
        'gap analysis': 'gaps',
        'formulate queries': 'formulate',
      };
      const labelColors: Record<string, string> = {
        'gaps': 'text-orange-400',
        'synthesis': 'text-purple-400',
        'dedup': 'text-text-muted',
        'followups': 'text-teal-400',
        'summarize': 'text-text-muted',
        'formulate': 'text-blue-400',
      };
      const rawLbl = s.label ?? 'step';
      const lbl = labelAliases[rawLbl] ?? rawLbl;
      const color = labelColors[lbl] ?? 'text-accent/70';
      return { typeLabel: lbl, typeColor: color, detail: '', chips };
    }
    const first = tools[0];
    const tool = first.tool ?? 'step';
    const shortTool = tool.replace('web_search', 'search').replace('search_web', 'search').replace('fetch_url', 'fetch');
    let detail = '';
    if (tool === 'web_search' || tool === 'search_web' || tool === 'search') {
      const q = (first.input as Record<string, unknown>)?.query as string ?? '';
      detail = q ? `"${q.slice(0, 80)}"` : '';
    } else if (tool === 'fetch_url' || tool === 'fetch') {
      const urls = s.tool_calls.flatMap(c => c.jina_fetches ?? []).map(j => {
        try { return new URL(j.url).hostname; } catch { return j.url; }
      });
      const count = s.tool_calls.flatMap(c => c.jina_fetches ?? []).length;
      detail = urls.slice(0, 2).join(' · ') + (count > 2 ? ` +${count - 2}` : '');
    } else {
      detail = s.label ?? shortTool;
    }
    const typeColor = shortTool === 'search' ? 'text-blue-400' : shortTool === 'fetch' ? 'text-teal-400' : 'text-accent/80';
    return { typeLabel: shortTool + (tools.length > 1 ? ` ×${tools.length}` : ''), typeColor, detail, chips };
  }
  return null;
}

function LiveView({
  threads, findings, allSteps, events, isRunning, sessionId, sessionFetchText,
  onToggleSessionFetch,
}: {
  threads: ResearchThread[];
  findings: ResearchFinding[];
  allSteps: ResearchStep[];
  events: StreamEvent[];
  isRunning: boolean;
  sessionId: string;
  sessionFetchText: boolean;
  onToggleSessionFetch: () => void;
  // kept for call-site compat, unused in 3-pane view
  activity?: ResearchActivity;
  jobs?: ResearchJob[];
  selectedThreadId?: string | null;
  onSelectThread?: (id: string) => void;
  onNavigateToDocument?: (threadId: string) => void;
  onNavigateToMap?: (threadId: string) => void;
}) {
  const updateThread = useUpdateThread();
  const redoThread = useRedoThread();
  const streamRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'finding' | 'thread' | 'step' | 'search' | 'fetch' | 'error'>('all');
  const [searchText, setSearchText] = useState('');
  const [expandedFindingId, setExpandedFindingId] = useState<string | null>(null);
  const [findingsSearch, setFindingsSearch] = useState('');
  const [threadSearch, setThreadSearch] = useState('');
  const [filterThreadId, setFilterThreadId] = useState<string | null>(null);
  const [expandedEventKey, setExpandedEventKey] = useState<string | null>(null);
  const [threadPanelWidth, setThreadPanelWidth] = useState(260);
  const [findingsPanelWidth, setFindingsPanelWidth] = useState(380);

  const startResizeThread = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = threadPanelWidth;
    const onMove = (ev: MouseEvent) => setThreadPanelWidth(Math.max(180, Math.min(420, startW + ev.clientX - startX)));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startResizeFindings = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = findingsPanelWidth;
    const onMove = (ev: MouseEvent) => setFindingsPanelWidth(Math.max(260, Math.min(640, startW + ev.clientX - startX)));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

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

  const ordered = useMemo(() => orderThreadsDepthFirst(threads), [threads]);

  const filteredThreads = useMemo(() => {
    if (!threadSearch.trim()) return ordered;
    const q = threadSearch.trim().toLowerCase();
    return ordered.filter(t => {
      const hay = (t.short_query ?? t.query).toLowerCase();
      let qi = 0;
      for (let i = 0; i < hay.length && qi < q.length; i++) {
        if (hay[i] === q[qi]) qi++;
      }
      return qi === q.length;
    });
  }, [ordered, threadSearch]);

  const threadColor = useMemo(() => {
    const map = new Map<string, string>();
    ordered.forEach((t, i) => map.set(t.id, THREAD_PALETTE[i % THREAD_PALETTE.length]));
    return map;
  }, [ordered]);

  const { highFindings, medFindings } = useMemo(() => {
    const sorted = [...findings].sort((a, b) => b.confidence - a.confidence);
    const q = findingsSearch.trim().toLowerCase();
    const filtered = q
      ? sorted.filter(f => f.content.toLowerCase().includes(q) || f.summary.toLowerCase().includes(q) || f.tags.some(t => t.toLowerCase().includes(q)))
      : sorted;
    return {
      highFindings: filtered.filter(f => f.confidence >= 0.7),
      medFindings: filtered.filter(f => f.confidence >= 0.4 && f.confidence < 0.7),
    };
  }, [findings, findingsSearch]);

  const activeThreads = useMemo(() => threads.filter(t => t.status === 'active'), [threads]);
  const queuedThreads = useMemo(() => threads.filter(t => t.status === 'queued'), [threads]);

  // Enrich thread events with a diff vs the previous event for the same thread.
  // Thread updated_at bumps for: status changes, short_query set, priority changed, retry_after set.
  type EnrichedEvent = StreamEvent & { threadDiff?: string };

  const streamEvents = useMemo(() => {
    const prevState = new Map<string, ResearchThread>();
    const enriched: EnrichedEvent[] = events.map(ev => {
      if (ev.type !== 'thread') return ev;
      const t = ev.payload;
      const prev = prevState.get(t.id);
      prevState.set(t.id, t);
      if (!prev) return ev; // first event — show as normal spawn/queued/etc.
      const changes: string[] = [];
      if (prev.status !== t.status) changes.push(`${prev.status} → ${t.status}`);
      if (prev.short_query !== t.short_query && t.short_query) changes.push(`titled`);
      if (Math.abs((prev.priority ?? 0) - (t.priority ?? 0)) > 0.005)
        changes.push(`priority ${prev.priority.toFixed(2)} → ${t.priority.toFixed(2)}`);
      if (!prev.retry_after && t.retry_after) changes.push(`backoff`);
      if (prev.retry_after && !t.retry_after && prev.status === t.status) changes.push(`retry`);
      return { ...ev, threadDiff: changes.join(' · ') || null } as EnrichedEvent;
    });

    let evs = enriched.reverse();
    if (filterType === 'finding') evs = evs.filter(e => e.type === 'finding');
    else if (filterType === 'thread') evs = evs.filter(e => e.type === 'thread');
    else if (filterType === 'step') evs = evs.filter(e => e.type === 'step');
    else if (filterType === 'search') evs = evs.filter(e => e.type === 'step' && (e.payload.tool_calls ?? []).some(tc => tc.tool === 'web_search' || tc.tool === 'search_web' || tc.tool === 'search'));
    else if (filterType === 'fetch') evs = evs.filter(e => e.type === 'step' && (e.payload.tool_calls ?? []).some(tc => tc.tool === 'fetch_url' || tc.tool === 'fetch'));
    else if (filterType === 'error') evs = evs.filter(e => e.type === 'step' && !!(e.payload as ResearchStep).error);
    if (filterThreadId) {
      evs = evs.filter(e => {
        if (e.type === 'finding') return (e.payload as ResearchFinding).thread_id === filterThreadId;
        if (e.type === 'step') return e.payload.thread_id === filterThreadId;
        if (e.type === 'thread') return e.payload.id === filterThreadId;
        return true;
      });
    }
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      evs = evs.filter(e => {
        const f = formatEventDetail(e);
        if (!f) return false;
        const haystack = [f.typeLabel, f.detail, ...(f.chips?.map(c => c.text) ?? [])].join(' ').toLowerCase();
        // fuzzy: all query chars must appear in order
        let qi = 0;
        for (let i = 0; i < haystack.length && qi < q.length; i++) {
          if (haystack[i] === q[qi]) qi++;
        }
        return qi === q.length;
      });
    }
    return evs;
  }, [events, filterType, filterThreadId, searchText]);

  useLayoutEffect(() => {
    if (autoScroll && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [streamEvents, autoScroll]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Pane 1: Thread controls (left) ── */}
      <div className="shrink-0 flex flex-col bg-bg-secondary overflow-hidden" style={{ width: threadPanelWidth }}>
        <div className="flex flex-col border-b border-border-primary shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 h-[37px]">
            {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse shrink-0" />}
            <span className="text-sm font-semibold uppercase tracking-wider text-text-secondary">Threads</span>
            <span className="text-sm text-text-disabled font-mono ml-auto">{threads.length}</span>
          </div>
          <div className="px-3 pb-2">
            <input
              type="text"
              value={threadSearch}
              onChange={e => setThreadSearch(e.target.value)}
              placeholder="search…"
              className="w-full bg-bg-tertiary border border-border-primary rounded px-2 py-0.5 text-sm text-text-secondary placeholder:text-text-disabled focus:outline-none focus:border-accent/50"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredThreads.map(thread => {
            const isTerminal = thread.status === 'exhausted' || thread.status === 'pruned';
            const threadFindings = findingsByThread.get(thread.id) ?? [];
            const steps = stepsByThread.get(thread.id) ?? [];
            const progressPct = steps.length > 0 ? Math.min(100, (steps.length / 9) * 100) : 0;
            return (
              <div
                key={thread.id}
                role="button"
                tabIndex={0}
                aria-pressed={filterThreadId === thread.id}
                onClick={() => setFilterThreadId(prev => prev === thread.id ? null : thread.id)}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setFilterThreadId(prev => prev === thread.id ? null : thread.id)}
                className={clsx(
                  'pl-3 pr-3 pt-1.5 pb-1.5 border-b border-border-primary border-l-4 group hover:bg-bg-tertiary transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent/50',
                  liveStatusBorder[thread.status] ?? 'border-l-text-muted/30',
                  filterThreadId === thread.id && 'bg-bg-tertiary/60'
                )}
              >
                <div className="flex items-start gap-1.5 mb-1">
                  <span className="text-sm font-medium text-text-primary line-clamp-2 flex-1 leading-snug">
                    {thread.short_query ?? thread.query}
                  </span>
                  {threadFindings.length > 0 && (
                    <span className="text-sm font-mono text-success shrink-0 leading-5">{threadFindings.length}✦</span>
                  )}
                </div>
                {thread.status === 'active' && (
                  <div className="h-0.5 bg-bg-tertiary rounded-full overflow-hidden mb-1">
                    <div className="h-full bg-success rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <span className={clsx('text-sm px-1 py-0.5 rounded shrink-0', liveOriginColor[thread.origin] ?? 'bg-bg-tertiary text-text-muted')}>
                    {thread.origin.replace(/_/g, ' ')}
                  </span>
                  <span className="text-sm font-mono text-text-muted ml-auto">p:{thread.priority.toFixed(2)}</span>
                  <button
                    title="Increase priority"
                    onClick={e => { e.stopPropagation(); updateThread.mutate({ id: thread.id, sessionId, priority: Math.min(1.0, thread.priority + 0.1) }); }}
                    className="p-0.5 text-text-muted hover:text-text-primary rounded hover:bg-bg-primary/40"
                  ><Icon name="keyboard_arrow_up" size="xs" /></button>
                  <button
                    title="Decrease priority"
                    onClick={e => { e.stopPropagation(); updateThread.mutate({ id: thread.id, sessionId, priority: Math.max(0.0, thread.priority - 0.1) }); }}
                    className="p-0.5 text-text-muted hover:text-text-primary rounded hover:bg-bg-primary/40"
                  ><Icon name="keyboard_arrow_down" size="xs" /></button>
                  {isTerminal ? (
                    <button
                      title="Redo"
                      onClick={e => { e.stopPropagation(); redoThread.mutate({ sessionId, threadId: thread.id }); }}
                      disabled={redoThread.isPending}
                      className="px-1 py-0.5 text-sm text-text-secondary hover:text-blue-400 rounded hover:bg-bg-primary/40"
                    >↺</button>
                  ) : (
                    <button
                      title="Prune"
                      onClick={e => { e.stopPropagation(); updateThread.mutate({ id: thread.id, sessionId, status: 'pruned' }); }}
                      className="p-0.5 text-text-muted hover:text-error rounded hover:bg-bg-primary/40"
                    ><Icon name="close" size="xs" /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-border-primary px-3 py-2 shrink-0 space-y-1.5">
          <button
            onClick={onToggleSessionFetch}
            className={clsx('w-full text-left px-2 py-1 rounded text-sm border transition-colors',
              sessionFetchText
                ? 'bg-green-900/30 border-green-700/30 text-green-400'
                : 'bg-bg-tertiary border-border-primary text-text-muted hover:text-text-secondary'
            )}
          >⬡ full-text: {sessionFetchText ? 'ON' : 'OFF'}</button>
        </div>
      </div>

      {/* Resize handle 1 */}
      <div
        className="w-1 shrink-0 cursor-col-resize bg-border-primary hover:bg-accent/40 transition-colors"
        onMouseDown={startResizeThread}
      />
      {/* ── Pane 2: Findings (center) ── */}
      <div className="flex flex-col overflow-hidden" style={{ width: findingsPanelWidth, minWidth: 0 }}>
        <div className="flex flex-col border-b border-border-primary bg-bg-secondary shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 h-[37px]">
            <span className="text-sm font-semibold uppercase tracking-wider text-text-secondary">Findings</span>
            <span className="text-sm text-text-muted font-mono ml-auto">{findings.length}</span>
          </div>
          <div className="px-3 pb-2">
            <input
              type="text"
              value={findingsSearch}
              onChange={e => setFindingsSearch(e.target.value)}
              placeholder="search…"
              className="w-full bg-bg-tertiary border border-border-primary rounded px-2 py-0.5 text-sm text-text-secondary placeholder:text-text-disabled focus:outline-none focus:border-accent/50"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {findings.length === 0 && activeThreads.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">No findings yet.</p>
          ) : (
            <>
              {highFindings.length > 0 && (
                <>
                  <p className="text-sm text-text-muted uppercase tracking-wide">High confidence ({highFindings.length})</p>
                  {highFindings.map(f => {
                    const isExpanded = expandedFindingId === f.id;
                    const srcMeta = f.source_url_meta?.length ? f.source_url_meta : f.source_urls.map(u => ({ url: u, title: '', snippet: '' }));
                    const thread = threads.find(t => t.id === f.thread_id);
                    const originLabel = !thread || thread.origin === 'seed' ? null
                      : thread.origin === 'perturbation' && thread.perturbation_strategy ? thread.perturbation_strategy.replace(/_/g, '·')
                      : thread.origin.replace(/_/g, '·');
                    const originCls = thread?.origin === 'follow_up' ? 'text-blue-400'
                      : thread?.origin === 'perturbation' ? 'text-orange-400'
                      : thread?.origin === 'user_injected' ? 'text-yellow-400'
                      : 'text-text-muted';
                    return (
                      <div key={f.id}
                        role="button"
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        onClick={() => setExpandedFindingId(isExpanded ? null : f.id)}
                        onKeyDown={e => e.key === 'Enter' || e.key === ' ' ? setExpandedFindingId(isExpanded ? null : f.id) : null}
                        className="bg-bg-secondary border border-border-primary rounded border-l-2 border-l-success px-3 py-2 space-y-1.5 cursor-pointer hover:bg-bg-tertiary/30 transition-colors focus:outline-none focus:ring-1 focus:ring-accent/50"
                      >
                        <Md className={clsx('text-sm leading-relaxed', !isExpanded && 'line-clamp-4')}>
                          {isExpanded ? f.content : f.content}
                        </Md>
                        {isExpanded && (
                          <div className="space-y-2 pt-1.5 border-t border-border-primary/30">
                            {srcMeta.length > 0 && (
                              <div>
                                <p className="text-sm text-text-muted uppercase tracking-wide mb-1">Sources</p>
                                <ol className="list-decimal list-inside space-y-0.5">
                                  {srcMeta.map((src, i) => {
                                    let host = src.url;
                                    try { host = new URL(src.url).hostname; } catch { /* keep */ }
                                    return (
                                      <li key={i} className="text-sm text-text-muted">
                                        <a href={src.url} target="_blank" rel="noopener noreferrer"
                                          onClick={e => e.stopPropagation()}
                                          className="text-accent hover:underline">
                                          {src.title || host}
                                        </a>
                                      </li>
                                    );
                                  })}
                                </ol>
                              </div>
                            )}
                            {f.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {f.tags.map(tag => (
                                  <span key={tag} className="px-1 py-0.5 rounded bg-bg-tertiary text-sm text-text-muted border border-border-primary/50">{tag}</span>
                                ))}
                              </div>
                            )}
                            {thread && (
                              <p className="text-sm text-text-muted italic truncate">{thread.short_query ?? thread.query}</p>
                            )}
                          </div>
                        )}
                        {!isExpanded && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {f.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 flex-1 min-w-0 overflow-hidden">
                                {f.tags.slice(0, 3).map(tag => (
                                  <span key={tag} className="text-sm text-text-muted bg-bg-tertiary border border-border-primary/60 px-1 py-0.5 rounded whitespace-nowrap">{tag}</span>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 ml-auto shrink-0">
                              {originLabel && <span className={clsx('text-sm font-mono', originCls)}>{originLabel}</span>}
                              <span className="text-sm font-mono text-text-secondary">{(f.confidence * 100).toFixed(0)}%</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
              {medFindings.length > 0 && (
                <>
                  <p className="text-sm text-text-muted uppercase tracking-wide mt-3">Medium confidence ({medFindings.length})</p>
                  {medFindings.map(f => {
                    const isExpanded = expandedFindingId === f.id;
                    const srcMeta = f.source_url_meta?.length ? f.source_url_meta : f.source_urls.map(u => ({ url: u, title: '', snippet: '' }));
                    const thread = threads.find(t => t.id === f.thread_id);
                    const originLabel = !thread || thread.origin === 'seed' ? null
                      : thread.origin === 'perturbation' && thread.perturbation_strategy ? thread.perturbation_strategy.replace(/_/g, '·')
                      : thread.origin.replace(/_/g, '·');
                    const originCls = thread?.origin === 'follow_up' ? 'text-blue-400'
                      : thread?.origin === 'perturbation' ? 'text-orange-400'
                      : thread?.origin === 'user_injected' ? 'text-yellow-400'
                      : 'text-text-muted';
                    return (
                      <div key={f.id}
                        role="button"
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        onClick={() => setExpandedFindingId(isExpanded ? null : f.id)}
                        onKeyDown={e => e.key === 'Enter' || e.key === ' ' ? setExpandedFindingId(isExpanded ? null : f.id) : null}
                        className="bg-bg-secondary border border-border-primary rounded border-l-2 border-l-blue-400/50 px-3 py-2 space-y-1.5 cursor-pointer hover:bg-bg-tertiary/30 transition-colors focus:outline-none focus:ring-1 focus:ring-accent/50"
                      >
                        <Md className={clsx('text-sm leading-relaxed', !isExpanded && 'line-clamp-4')}>
                          {f.content}
                        </Md>
                        {isExpanded && (
                          <div className="space-y-2 pt-1.5 border-t border-border-primary/30">
                            {srcMeta.length > 0 && (
                              <div>
                                <p className="text-sm text-text-muted uppercase tracking-wide mb-1">Sources</p>
                                <ol className="list-decimal list-inside space-y-0.5">
                                  {srcMeta.map((src, i) => {
                                    let host = src.url;
                                    try { host = new URL(src.url).hostname; } catch { /* keep */ }
                                    return (
                                      <li key={i} className="text-sm text-text-muted">
                                        <a href={src.url} target="_blank" rel="noopener noreferrer"
                                          onClick={e => e.stopPropagation()}
                                          className="text-accent hover:underline">
                                          {src.title || host}
                                        </a>
                                      </li>
                                    );
                                  })}
                                </ol>
                              </div>
                            )}
                            {f.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {f.tags.map(tag => (
                                  <span key={tag} className="px-1 py-0.5 rounded bg-bg-tertiary text-sm text-text-muted border border-border-primary/50">{tag}</span>
                                ))}
                              </div>
                            )}
                            {thread && (
                              <p className="text-sm text-text-muted italic truncate">{thread.short_query ?? thread.query}</p>
                            )}
                          </div>
                        )}
                        {!isExpanded && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {f.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 flex-1 min-w-0 overflow-hidden">
                                {f.tags.slice(0, 3).map(tag => (
                                  <span key={tag} className="text-sm text-text-muted bg-bg-tertiary border border-border-primary/60 px-1 py-0.5 rounded whitespace-nowrap">{tag}</span>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 ml-auto shrink-0">
                              {originLabel && <span className={clsx('text-sm font-mono', originCls)}>{originLabel}</span>}
                              <span className="text-sm font-mono text-text-secondary">{(f.confidence * 100).toFixed(0)}%</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
              {activeThreads.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-sm font-semibold text-text-secondary">Investigating</p>
                  {activeThreads.map(t => (
                    <div key={t.id} className="flex items-center gap-2 text-sm text-text-secondary">
                      <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse shrink-0" />
                      <span className="truncate">{t.short_query ?? t.query}</span>
                    </div>
                  ))}
                  {queuedThreads.slice(0, 3).map(t => (
                    <div key={t.id} className="flex items-center gap-2 text-sm text-text-muted">
                      <span className="w-1.5 h-1.5 rounded-full bg-warning/60 shrink-0" />
                      <span className="truncate">{t.short_query ?? t.query}</span>
                    </div>
                  ))}
                  {queuedThreads.length > 3 && (
                    <p className="text-sm text-text-muted pl-3.5">+{queuedThreads.length - 3} queued</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Resize handle 2 */}
      <div
        className="w-1 shrink-0 cursor-col-resize bg-border-primary hover:bg-accent/40 transition-colors"
        onMouseDown={startResizeFindings}
      />
      {/* ── Pane 3: Live event stream (right) ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-bg-primary">
        <>
          {/* Event log header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-primary bg-bg-secondary shrink-0 h-[37px]">
            <span className="text-sm font-semibold uppercase tracking-wider text-text-secondary shrink-0">Event Log</span>
            {filterThreadId && (() => {
              const ft = threads.find(t => t.id === filterThreadId);
              const ftColor = threadColor.get(filterThreadId) ?? '#8796b0';
              return (
                <div className="flex items-center gap-2 flex-1 overflow-hidden ml-2">
                  <div
                    className="text-sm px-1.5 py-0.5 rounded border truncate max-w-48"
                    style={{ background: `${ftColor}15`, borderColor: `${ftColor}35`, color: ftColor }}
                  >
                    {ft ? (ft.short_query ?? ft.query) : filterThreadId.slice(0, 12)}
                  </div>
                  <button
                    onClick={() => setFilterThreadId(null)}
                    className="text-sm text-text-muted hover:text-text-primary px-1 py-0.5 rounded border border-border-primary shrink-0 transition-colors"
                  >× clear</button>
                </div>
              );
            })()}
            <span className="text-sm text-text-muted font-mono ml-auto shrink-0">
              {streamEvents.length !== events.length ? `${streamEvents.length} / ${events.length}` : events.length}
            </span>
            <button
              title="Download activity log (.md)"
              onClick={() => { const a = document.createElement('a'); a.href = `/api/research/queries/${sessionId}/export/log`; a.download = ''; a.click(); }}
              className="p-1 rounded text-text-muted hover:text-text-secondary hover:bg-bg-tertiary transition-colors shrink-0"
            ><Icon name="download" size="xs" /></button>
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border-primary bg-bg-secondary shrink-0">
            <input
              type="text"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="search…"
              className="flex-1 min-w-0 bg-bg-tertiary border border-border-primary rounded px-2 py-0.5 text-sm text-text-secondary placeholder:text-text-disabled focus:outline-none focus:border-accent/50"
            />
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value as typeof filterType)}
              className="bg-bg-tertiary border border-border-primary rounded px-1.5 py-0.5 text-sm text-text-secondary focus:outline-none focus:border-accent/50 shrink-0"
            >
              <option value="all">all</option>
              <option value="finding">findings</option>
              <option value="thread">threads</option>
              <option value="step">steps</option>
              <option value="search">search</option>
              <option value="fetch">fetch</option>
              <option value="error">errors</option>
            </select>
            <button
              onClick={() => { if (streamRef.current) streamRef.current.scrollTop = 0; }}
              title="Scroll to first"
              className="px-1.5 py-0.5 rounded text-sm border border-border-primary bg-bg-tertiary text-text-muted hover:text-text-secondary transition-colors font-mono"
            >▲</button>
            <button
              onClick={() => { if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight; }}
              title="Scroll to last"
              className="px-1.5 py-0.5 rounded text-sm border border-border-primary bg-bg-tertiary text-text-muted hover:text-text-secondary transition-colors font-mono"
            >▼</button>
            <button
              onClick={() => setAutoScroll(a => !a)}
              className={clsx('px-1.5 py-0.5 rounded text-sm border transition-colors shrink-0',
                autoScroll
                  ? 'border-success/25 bg-success/8 text-success'
                  : 'border-border-primary bg-bg-tertiary text-text-muted'
              )}
            >↓ auto</button>
          </div>

          {/* Event stream */}
          <div
            ref={streamRef}
            className="flex-1 overflow-y-auto py-1"
            onScroll={e => {
              const el = e.currentTarget;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
              setAutoScroll(atBottom);
            }}
          >
            {streamEvents.length === 0 && (
              <p className="text-sm text-text-muted text-center py-8">Waiting for events…</p>
            )}
            {streamEvents.length > RENDER_WINDOW && (
              <p className="text-sm text-text-muted text-center py-1.5 border-b border-border-primary/20">
                {streamEvents.length - RENDER_WINDOW} older events not shown
              </p>
            )}
            {streamEvents.slice(-RENDER_WINDOW).map(ev => {
              const formatted = formatEventDetail(ev);
              if (!formatted) return null;
              const evKey = ev.type === 'thread'
                ? `thread:${ev.payload.id}:${ev.payload.updated_at ?? ev.payload.created_at}`
                : `${ev.type}:${(ev.payload as { id: string }).id}`;
              const isExpanded = expandedEventKey === evKey;
              const threadId = ev.type === 'finding' ? ev.payload.thread_id
                : ev.type === 'step' ? ev.payload.thread_id
                : ev.type === 'thread' ? ev.payload.id
                : null;
              const color = threadId ? (threadColor.get(threadId) ?? '#8796b0') : '#8796b0';
              const thread = threadId ? ordered.find(t => t.id === threadId) ?? null : null;
              const threadIdx = threadId ? ordered.findIndex(t => t.id === threadId) : -1;
              const ts = ev.type === 'finding' ? ev.payload.created_at
                : ev.type === 'step' ? ev.payload.created_at
                : ev.type === 'thread' ? ev.payload.created_at
                : null;
              const timeStr = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '';
              const isFinding = ev.type === 'finding';
              // For label-only steps with no detail, show abbreviated thread query
              const isLabelOnlyStep = ev.type === 'step' && (ev.payload.tool_calls ?? []).length === 0;
              const abbrevThreadQ = thread ? (thread.short_query ?? thread.query) : null;
              const displayDetail = formatted.detail || (isLabelOnlyStep && abbrevThreadQ) || '';
              const isHighFinding = isFinding && (ev.payload as ResearchFinding).confidence >= 0.7;
              const isError = ev.type === 'step' && !!(ev.payload as ResearchStep).error;
              return (
                <div
                  key={evKey}
                  className={clsx(
                    'border-b border-border-primary/20 transition-colors',
                    isError ? 'bg-error/8'
                      : isFinding
                        ? isHighFinding ? 'bg-warning/5' : 'bg-success/4'
                        : isExpanded ? 'bg-bg-secondary/60' : 'hover:bg-bg-secondary/40'
                  )}
                  style={{ borderLeft: `6px solid ${color}${isHighFinding ? 'cc' : '60'}` }}
                >
                  {/* Collapsed row */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedEventKey(prev => prev === evKey ? null : evKey)}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setExpandedEventKey(prev => prev === evKey ? null : evKey)}
                    className="grid items-baseline px-3 py-1 cursor-pointer focus:outline-none"
                    style={{ gridTemplateColumns: '72px 90px auto 1fr auto', gap: '0' }}
                  >
                    <span className="text-sm text-text-muted font-mono pr-1.5 overflow-hidden">{timeStr}</span>
                    <span className={clsx('text-sm font-mono pr-2 shrink-0', formatted.typeColor)}>{formatted.typeLabel}</span>
                    <span className="flex items-baseline gap-1.5 pr-2 shrink-0">
                      {formatted.chips?.filter(c => !c.meta).map((chip, ci) => (
                        <span key={ci} className={clsx('text-sm font-mono', chip.color)}>{chip.text}</span>
                      ))}
                    </span>
                    <span className="text-sm min-w-0 truncate text-text-secondary pr-2">
                      {displayDetail}
                    </span>
                    <span className="flex items-baseline gap-1.5 justify-end shrink-0">
                      {formatted.chips?.filter(c => c.meta).map((chip, ci) => (
                        <span key={ci} className={clsx('text-sm font-mono', chip.color)}>{chip.text}</span>
                      ))}
                    </span>
                  </div>
                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-3 pb-2.5 pt-1 space-y-1.5 border-l-2 ml-[168px]" style={{ borderLeftColor: `${color}40` }}>
                      {ev.type === 'step' && (() => {
                        const s = ev.payload;
                        return (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-sm text-text-muted flex-wrap">
                              <span className="text-blue-400/80 font-mono">llm</span>
                              <span className="font-mono">{s.model}</span>
                              <span>{s.prompt_tokens}+{s.completion_tokens}</span>
                              {s.cost_usd > 0 && <span>${s.cost_usd.toFixed(4)}</span>}
                              {s.duration_ms > 0 && <span>{(s.duration_ms / 1000).toFixed(1)}s</span>}
                            </div>
                            {s.label && s.tool_calls.length > 0 && <p className="text-sm text-text-secondary font-mono">{s.label}</p>}
                            {s.label === 'summarize thread' && thread && (
                              <div className="text-sm space-y-0.5">
                                <p className="text-text-secondary">Generates short conceptual title for thread</p>
                                <p className="text-text-secondary truncate">query: {thread.short_query ?? thread.query}</p>
                                {thread.short_query && <p className="text-text-primary">title: {thread.short_query}</p>}
                              </div>
                            )}
                            {s.tool_calls.map((tc, ti) => (
                              <div key={ti} className="space-y-0.5">
                                <div className="flex items-start gap-2">
                                  <span className="text-text-secondary text-sm font-mono shrink-0">
                                    {tc.tool === 'web_search' ? 'search' : tc.tool}
                                  </span>
                                  {tc.input && (
                                    <span className="text-sm text-text-primary break-words flex-1">
                                      {(tc.tool === 'web_search' || tc.tool === 'search_web') && (tc.input as Record<string,unknown>).query
                                        ? `"${(tc.input as Record<string,unknown>).query as string}"`
                                        : <span className="text-text-secondary text-sm font-mono">{JSON.stringify(tc.input).slice(0, 160)}</span>}
                                    </span>
                                  )}
                                </div>
                                {tc.jina_fetches && tc.jina_fetches.length > 0 && (
                                  <div className="pl-3 text-sm text-text-secondary">
                                    {tc.jina_fetches.map((j, ji) => {
                                      let host = j.url; try { host = new URL(j.url).hostname; } catch { /* keep */ }
                                      return <span key={ji} className={clsx('mr-2', j.ok ? 'text-teal-400' : 'text-error')}>{host}</span>;
                                    })}
                                  </div>
                                )}
                                {tc.output && <p className="pl-3 text-sm text-text-secondary/70 break-words">{tc.output.slice(0, 300)}{tc.output.length > 300 ? '…' : ''}</p>}
                              </div>
                            ))}
                            {s.metadata && (() => {
                              const m = s.metadata;
                              if (m.decision === 'gap_analysis') return (
                                <div className="text-sm">
                                  <span className={m.has_gaps ? 'text-warning' : 'text-text-secondary'}>
                                    {m.has_gaps ? `${m.gap_count as number} gaps` : 'no gaps'}
                                  </span>
                                </div>
                              );
                              if (m.decision === 'synthesis') return (
                                <div className="flex gap-3 text-sm font-mono">
                                  <span className="text-success">conf {((m.confidence as number) * 100).toFixed(0)}%</span>
                                  <span className="text-blue-400">novel {((m.novelty as number) * 100).toFixed(0)}%</span>
                                  <span className="text-text-muted">act {((m.actionability as number) * 100).toFixed(0)}%</span>
                                  {(m.tags as string[]).length > 0 && (
                                    <span className="text-text-secondary">{(m.tags as string[]).join(', ')}</span>
                                  )}
                                </div>
                              );
                              if (m.decision === 'dedup') return (
                                <div className="space-y-1 text-sm">
                                  <p className={clsx((m.is_duplicate as boolean) ? 'text-error' : 'text-text-secondary')}>
                                    {(m.is_duplicate as boolean) ? 'duplicate detected' : `unique · checked ${m.existing_count as number} findings`}
                                  </p>
                                  {(m.new_summary as string) && (
                                    <p className="text-text-secondary italic">new: "{m.new_summary as string}"</p>
                                  )}
                                  {(m.compared_to as string[] | undefined)?.map((s, i) => (
                                    <p key={i} className="pl-3 text-text-secondary/60 truncate">vs: "{s}"</p>
                                  ))}
                                </div>
                              );
                              if (m.decision === 'follow_up_eval') return (
                                <div className="space-y-0.5 text-sm">
                                  <p className="text-text-secondary">
                                    {m.accepted_count as number} accepted · {m.rejected_count as number} rejected
                                    {(m.retry_count as number) > 0 && ` · ${m.retry_count as number} retries`}
                                    {(m.similarity_threshold as number) && ` · sim≥${(m.similarity_threshold as number).toFixed(2)}`}
                                  </p>
                                  {(m.candidates as Array<{text: string; accepted: boolean; reason: string|null; sim: number; rank: number}> | undefined)?.map((c, i) => (
                                    <div key={i} className={clsx('pl-2 flex gap-2 items-baseline', c.accepted ? 'text-text-secondary' : 'text-text-muted/60')}>
                                      <span className="shrink-0">{c.accepted ? '✓' : '✗'}</span>
                                      <span className="truncate flex-1">"{c.text}"</span>
                                      <span className="font-mono shrink-0 text-sm">sim {c.sim.toFixed(2)}</span>
                                      {c.reason && <span className="text-error/70 shrink-0 text-sm truncate max-w-32">{c.reason}</span>}
                                    </div>
                                  ))}
                                </div>
                              );
                              if (m.decision === 'formulate_queries') return (
                                <div className="space-y-0.5 text-sm">
                                  <p className="text-text-secondary">{(m.queries as string[]).length} queries formulated{(m.skipped_duplicates as number) > 0 && `, ${m.skipped_duplicates as number} skipped (already searched)`}</p>
                                  {(m.queries as string[]).map((q, i) => (
                                    <p key={i} className="pl-2 text-text-secondary/80 truncate">→ "{q}"</p>
                                  ))}
                                </div>
                              );
                              return null;
                            })()}
                            {s.error && (
                              <div className="mt-1 p-2 rounded bg-error/8 border border-error/20">
                                <p className="text-sm font-mono text-error break-words whitespace-pre-wrap">{s.error}</p>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {ev.type === 'finding' && (() => {
                        const f = ev.payload;
                        const srcMeta = f.source_url_meta?.length ? f.source_url_meta : f.source_urls.map(u => ({ url: u, title: '', snippet: '' }));
                        return (
                          <div className="space-y-1.5">
                            <div className="text-sm text-text-primary leading-relaxed prose prose-sm prose-invert max-w-none">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{f.content}</ReactMarkdown>
                            </div>
                            <div className="flex items-center gap-3 text-sm font-mono flex-wrap">
                              <span className={f.confidence >= 0.7 ? 'text-success' : f.confidence >= 0.4 ? 'text-warning' : 'text-error'}>
                                conf {(f.confidence * 100).toFixed(0)}%
                              </span>
                              <span className="text-blue-400">novel {(f.novelty * 100).toFixed(0)}%</span>
                              <span className="text-text-muted">act {(f.actionability * 100).toFixed(0)}%</span>
                            </div>
                            {srcMeta.length > 0 && (
                              <div className="space-y-0.5">
                                {srcMeta.map((src, si) => {
                                  let host = src.url; try { host = new URL(src.url).hostname; } catch { /* keep */ }
                                  return (
                                    <a key={si} href={src.url} target="_blank" rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      className="block text-sm text-accent hover:underline truncate">
                                      {src.title || host}
                                    </a>
                                  );
                                })}
                              </div>
                            )}
                            {f.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {f.tags.map(tag => (
                                  <span key={tag} className="px-1 py-0.5 rounded bg-bg-tertiary text-sm text-text-muted">{tag}</span>
                                ))}
                              </div>
                            )}
                            {f.follow_up_analysis && (
                              <div className="space-y-1 pt-1 border-t border-border-primary/30">
                                <p className="text-sm font-semibold uppercase tracking-wider text-text-muted">
                                  Follow-up candidates · threshold {(f.follow_up_analysis.similarity_threshold * 100).toFixed(0)}%
                                  {f.follow_up_analysis.retry_count > 0 && ` · ${f.follow_up_analysis.retry_count} retries`}
                                </p>
                                {f.follow_up_analysis.candidates.map((c, ci) => (
                                  <div key={ci} className="flex items-start gap-2">
                                    <span className={clsx('text-sm font-mono shrink-0 mt-0.5', c.accepted ? 'text-success' : 'text-error')}>
                                      {c.accepted ? '✓' : '✗'}
                                    </span>
                                    <span className={clsx('text-sm flex-1', c.accepted ? 'text-text-primary' : 'text-text-muted')}>{c.text}</span>
                                    <span className="text-sm font-mono text-text-muted shrink-0">
                                      q:{(c.quality_score * 100).toFixed(0)}% r:{(c.rank_score * 100).toFixed(0)}%
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {ev.type === 'thread' && (() => {
                        const t = ev.payload;
                        return (
                          <div className="space-y-1 text-sm text-text-muted">
                            <p className="text-text-secondary">{t.query}</p>
                            <div className="flex items-center gap-3">
                              <span>depth <span className="font-mono">{t.depth}/{t.max_depth}</span></span>
                              <span>priority <span className="font-mono">{t.priority.toFixed(2)}</span></span>
                              <span className={clsx('px-1 py-0.5 rounded text-sm', liveOriginColor[t.origin] ?? 'bg-bg-tertiary text-text-muted')}>
                                {t.origin.replace(/_/g, ' ')}
                              </span>
                              {t.perturbation_strategy && (
                                <span className="text-orange-400/70">{t.perturbation_strategy.replace(/_/g, ' ')}</span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
            {isRunning && (
              <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-success font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                <span>running</span>
                <span className="text-text-muted ml-2">{events.length} events · {findings.length} findings</span>
              </div>
            )}
          </div>
        </>
      </div>
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
        <span className="text-sm text-text-muted">Depth:</span>
        {(['all', '0-2', '3-5', '6+'] as const).map(d => (
          <button
            key={d}
            onClick={() => setDepthFilter(d)}
            className={clsx('px-2 py-1 rounded text-sm border transition-colors',
              depthFilter === d
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'bg-bg-secondary border-border-primary text-text-muted hover:text-text-secondary'
            )}
          >{d === 'all' ? 'All' : d}</button>
        ))}
        <label className="ml-4 flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={hideExhausted} onChange={e => setHideExhausted(e.target.checked)} className="accent-accent" />
          <span className="text-sm text-text-muted">Hide exhausted</span>
        </label>
        <button
          onClick={resetLayout}
          className="ml-auto px-2 py-1 rounded text-sm border bg-bg-secondary border-border-primary text-text-muted hover:text-text-secondary transition-colors"
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
    ? <span className="inline-flex items-center gap-1 text-sm font-medium text-success"><span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />{label}</span>
    : <span className="inline-flex items-center gap-1 text-sm font-medium text-error"><span className="w-1.5 h-1.5 rounded-full bg-error inline-block" />{label} not set</span>;
}

function SourcesView({ sessionId }: { sessionId: string }) {
  const [filter, setFilter] = useState<SourceExtractionStatus | 'all'>('all');
  const { data, isLoading } = useSources(sessionId, filter);
  const retry = useRetrySource();
  const skip = useSkipSource();

  if (isLoading) return <PageLoading />;
  const items: Source[] = data?.items ?? [];
  const counts = data?.counts ?? { pending: 0, extracted: 0, failed: 0, skipped: 0 };
  const total = counts.pending + counts.extracted + counts.failed + counts.skipped;

  const tabs: Array<{ key: SourceExtractionStatus | 'all'; label: string; n: number }> = [
    { key: 'all', label: 'All', n: total },
    { key: 'pending', label: 'Pending', n: counts.pending },
    { key: 'extracted', label: 'Extracted', n: counts.extracted },
    { key: 'failed', label: 'Failed', n: counts.failed },
    { key: 'skipped', label: 'Skipped', n: counts.skipped },
  ];

  const statusBadge = (s: SourceExtractionStatus) => {
    const map: Record<SourceExtractionStatus, string> = {
      pending: 'text-text-muted bg-bg-secondary',
      claimed: 'text-accent bg-accent/10',
      extracted: 'text-success bg-success/10',
      failed: 'text-error bg-error/10',
      skipped: 'text-text-muted bg-bg-secondary',
    };
    return <span className={clsx('px-1.5 py-0.5 rounded text-sm font-medium', map[s])}>{s}</span>;
  };

  return (
    <div className="max-w-[72ch] mx-auto">
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-border">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            className={clsx('px-2 py-1 text-sm rounded transition-colors',
              filter === t.key ? 'bg-bg-secondary text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
            {t.label} <span className="text-text-muted">({t.n})</span>
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-text-muted py-8 text-center">No sources in this bucket.</div>
      ) : (
        <ul className="space-y-2">
          {items.map(src => (
            <li key={src.id} className="border border-border rounded p-3 bg-bg-primary">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {statusBadge(src.extraction_status)}
                    {src.attempt_count > 0 && (
                      <span className="text-sm text-text-muted">attempts: {src.attempt_count}</span>
                    )}
                  </div>
                  <a href={src.url} target="_blank" rel="noopener noreferrer"
                    className="block text-sm font-medium text-accent hover:underline truncate">
                    {src.title || src.url}
                  </a>
                  <div className="text-sm text-text-muted truncate mt-0.5">{src.url}</div>
                  {src.snippet && (
                    <div className="text-sm text-text-secondary mt-1.5 line-clamp-2">{src.snippet}</div>
                  )}
                  {src.error && (
                    <div className="text-sm text-error mt-1.5 font-mono">{src.error}</div>
                  )}
                  {src.extracted_text && (
                    <details className="mt-2">
                      <summary className="text-sm text-text-muted cursor-pointer hover:text-text-secondary">
                        Extracted text ({src.extracted_text.length.toLocaleString()} chars)
                      </summary>
                      <pre className="mt-2 text-sm bg-bg-secondary p-2 rounded max-h-64 overflow-auto whitespace-pre-wrap">
                        {src.extracted_text.slice(0, 4000)}
                        {src.extracted_text.length > 4000 && '\n\n...[truncated]'}
                      </pre>
                    </details>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  {(src.extraction_status === 'failed' || src.extraction_status === 'skipped') && (
                    <Button size="sm" variant="secondary"
                      onClick={() => retry.mutate({ sourceId: src.id, sessionId })}
                      disabled={retry.isPending}>
                      Retry
                    </Button>
                  )}
                  {src.extraction_status === 'pending' && (
                    <Button size="sm" variant="secondary"
                      onClick={() => skip.mutate({ sourceId: src.id, sessionId })}
                      disabled={skip.isPending}>
                      Skip
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KnowledgeView({ sessionId }: { sessionId: string }) {
  const { data: concepts, isLoading } = useConcepts(sessionId);
  const { data: links } = useConceptLinks(sessionId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: detail } = useConceptDetail(sessionId, selectedId);

  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const elements = useMemo((): cytoscape.ElementDefinition[] => {
    if (!concepts) return [];
    const nodes: cytoscape.ElementDefinition[] = concepts.map(c => ({
      data: {
        id: c.id,
        label: c.canonical_name,
        findingCount: c.finding_count,
        sourceCount: c.source_count,
      },
    }));
    const byId = new Set(concepts.map(c => c.id));
    const edges: cytoscape.ElementDefinition[] = (links ?? [])
      .filter(l => byId.has(l.from_concept_id) && byId.has(l.to_concept_id))
      .map(l => ({
        data: {
          id: l.id,
          source: l.from_concept_id,
          target: l.to_concept_id,
          label: l.relation,
        },
      }));
    return [...nodes, ...edges];
  }, [concepts, links]);

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#89b4fa',
            'label': 'data(label)',
            'color': '#1e1e2e',
            'font-size': '14px',
            'font-weight': 'bold',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '140px',
            'shape': 'round-rectangle',
            'width': (ele: cytoscape.NodeSingular) => {
              const lbl = ele.data('label') as string | undefined;
              return Math.max(90, Math.min(180, (lbl?.length ?? 10) * 8));
            },
            'height': 40,
            'padding': '8px',
            'border-width': 1.5,
            'border-color': '#313147',
          } as cytoscape.Css.Node,
        },
        {
          selector: 'node:selected',
          style: {
            'border-color': '#f9e2af',
            'border-width': 3,
          } as cytoscape.Css.Node,
        },
        {
          selector: 'node.dimmed',
          style: { 'opacity': 0.3 } as cytoscape.Css.Node,
        },
        {
          selector: 'edge',
          style: {
            'line-color': '#45475a',
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#45475a',
            'arrow-scale': 0.9,
            'width': 1.5,
            'label': 'data(label)',
            'font-size': '14px',
            'color': '#a6adc8',
            'text-background-color': '#1e1e2e',
            'text-background-opacity': 0.8,
            'text-background-padding': '2px',
          } as cytoscape.Css.Edge,
        },
        {
          selector: 'edge.highlighted',
          style: {
            'line-color': '#f9e2af',
            'target-arrow-color': '#f9e2af',
            'width': 2.5,
          } as cytoscape.Css.Edge,
        },
      ],
      layout: {
        name: 'fcose',
        animate: true,
        animationDuration: 500,
        nodeRepulsion: 8000,
        idealEdgeLength: 110,
        gravity: 0.25,
        gravityRange: 3.8,
        nodeSeparation: 90,
      } as cytoscape.LayoutOptions,
    });

    cy.on('tap', 'node', (evt) => {
      const id = evt.target.data('id') as string;
      setSelectedId(id);
    });

    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target as cytoscape.NodeSingular;
      cy.elements().not(node.connectedEdges()).not(node).addClass('dimmed');
      node.connectedEdges().addClass('highlighted');
    });

    cy.on('mouseout', 'node', () => {
      cy.elements().removeClass('dimmed highlighted');
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) setSelectedId(null);
    });

    cyRef.current = cy;
    return () => { cy.destroy(); cyRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.json({ elements });
    cy.layout({
      name: 'fcose',
      animate: true,
      animationDuration: 350,
      nodeRepulsion: 8000,
      idealEdgeLength: 110,
    } as cytoscape.LayoutOptions).run();
  }, [elements]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !selectedId) return;
    cy.$('node:selected').unselect();
    cy.$id(selectedId).select();
  }, [selectedId]);

  if (isLoading) return <PageLoading />;
  if (!concepts || concepts.length === 0) {
    return (
      <div className="p-8 text-sm text-text-muted">
        No concepts have been extracted yet. Run the session for a few iterations — concepts are
        extracted from each finding after synthesis.
      </div>
    );
  }

  return (
    <div className="flex h-[70vh]">
      <div ref={containerRef} className="flex-1 border border-border rounded bg-bg-secondary" />
      <aside className="w-96 ml-4 flex flex-col gap-4 overflow-y-auto">
        {selectedId && detail ? (
          <ConceptInspector concept={detail} />
        ) : (
          <ConceptList concepts={concepts} selectedId={selectedId} onSelect={setSelectedId} />
        )}
      </aside>
    </div>
  );
}

function ConceptList({
  concepts, selectedId, onSelect,
}: {
  concepts: ConceptWithStats[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="border border-border rounded bg-bg-secondary">
      <div className="px-3 py-2 text-sm font-semibold border-b border-border">
        {concepts.length} concepts
      </div>
      <ul className="divide-y divide-border">
        {concepts.map(c => (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c.id)}
              className={`w-full text-left px-3 py-2 hover:bg-bg-hover ${
                selectedId === c.id ? 'bg-bg-hover' : ''
              }`}
            >
              <div className="text-sm font-medium">{c.canonical_name}</div>
              <div className="text-sm text-text-muted">
                {c.finding_count} findings · {c.source_count} sources
              </div>
              {c.summary && (
                <div className="text-sm text-text-muted mt-1 line-clamp-2">{c.summary}</div>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConceptInspector({ concept }: { concept: import('../../api/research-hooks').ConceptDetail }) {
  return (
    <div className="border border-border rounded bg-bg-secondary p-4 flex flex-col gap-3">
      <div>
        <div className="text-base font-semibold">{concept.canonical_name}</div>
        {concept.aliases.length > 0 && (
          <div className="text-sm text-text-muted mt-1">
            Also known as: {concept.aliases.join(', ')}
          </div>
        )}
      </div>

      {concept.summary && (
        <p className="text-sm leading-relaxed">{concept.summary}</p>
      )}

      {concept.key_facts.length > 0 && (
        <div>
          <div className="text-sm font-semibold mb-1">Key facts</div>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {concept.key_facts.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}

      <div className="text-sm text-text-muted">
        {concept.finding_count} findings · {concept.sources.length} sources
      </div>

      {concept.sources.length > 0 && (
        <div>
          <div className="text-sm font-semibold mb-1">Sources</div>
          <ul className="space-y-1">
            {concept.sources.slice(0, 15).map((s, i) => (
              <li key={i} className="text-sm">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SessionConfigView({
  session, sessionId,
}: {
  session: { id: string; config: Record<string, unknown> };
  sessionId: string;
}) {
  const updateConfig = useUpdateQueryConfig();
  const { data: defaults, isLoading } = useResearchDefaults();

  if (isLoading || !defaults) return <PageLoading />;

  const save = (path: string, value: unknown) => {
    updateConfig.mutate({ id: sessionId, config: patchByPath(path, value) });
  };

  const resetField = (path: string) => {
    const defaultValue = getByPath(defaults, path);
    updateConfig.mutate({ id: sessionId, config: patchByPath(path, defaultValue) });
  };

  return (
    <ConfigForm
      title="Session config"
      subtitle="Per-query overrides. The dot marks a value that differs from the defaults; changes apply to the next iteration."
      value={session.config}
      baseline={defaults as unknown as Record<string, unknown>}
      onSave={save}
      onResetField={resetField}
    />
  );
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
  const followUpCfg = (cfg.follow_up as Record<string, unknown>) ?? {};
  const topicCoherence = (cfg.topic_coherence as Record<string, unknown>) ?? {};
  const scheduleCfg = (cfg.schedule as Record<string, unknown>) ?? {};
  const initWindows = (scheduleCfg.active_windows as Array<{ days: string[]; start: string; end: string }>) ?? [];
  const initWindow = initWindows[0] ?? { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' };

  const [title, setTitle] = useState(session.title);
  const [provider, setProvider] = useState<string>((providers.primary as string) ?? 'anthropic');
  const [model, setModel] = useState<string>((cfg.model as string) ?? '');
  const [maxDepth, setMaxDepth] = useState<number>((cfg.max_thread_depth as number) ?? 5);
  const [maxTotalThreads, setMaxTotalThreads] = useState<number>((cfg.max_total_threads as number) ?? 200);
  const [minSearches, setMinSearches] = useState<number>((cfg.min_searches_per_thread as number) ?? 2);
  const [maxConcurrentThreads, setMaxConcurrentThreads] = useState<number>((cfg.max_concurrent_threads as number) ?? 2);
  const [maxStepsPerHour, setMaxStepsPerHour] = useState<number>((cfg.max_steps_per_hour as number) ?? 30);
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
  const [pSerendipity, setPSerendipity] = useState<number>((cfg.p_serendipity as number) ?? 0.15);
  const [followUpMin, setFollowUpMin] = useState<number>((followUpCfg.min_count as number) ?? 2);
  const [followUpMax, setFollowUpMax] = useState<number>((followUpCfg.max_count as number) ?? 5);
  const [seedSimilarityMin, setSeedSimilarityMin] = useState<number>((topicCoherence.seed_similarity_min as number) ?? 0.0);
  const [hopSimilarityMin, setHopSimilarityMin] = useState<number>((topicCoherence.hop_similarity_min as number) ?? 0.0);
  const [burstIterations, setBurstIterations] = useState<number>((cfg.burst_iterations as number) ?? 10);
  const [scheduleDays, setScheduleDays] = useState<string[]>(initWindow.days);
  const [scheduleStart, setScheduleStart] = useState<string>(initWindow.start);
  const [scheduleEnd, setScheduleEnd] = useState<string>(initWindow.end);
  const [scheduleTimezone, setScheduleTimezone] = useState<string>(
    (scheduleCfg.timezone as string) ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  );
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
      max_total_threads: maxTotalThreads,
      min_searches_per_thread: minSearches,
      max_concurrent_threads: maxConcurrentThreads,
      max_steps_per_hour: maxStepsPerHour,
      fetch_source_text: fetchSourceText,
      budget_daily_usd: budgetDaily,
      p_serendipity: pSerendipity,
      follow_up: {
        ...(followUpCfg as object),
        min_count: followUpMin,
        max_count: followUpMax,
      },
      topic_coherence: {
        seed_similarity_min: seedSimilarityMin,
        hop_similarity_min: hopSimilarityMin,
      },
      gap_analysis: { enabled: gapEnabled, max_gap_searches: maxGapSearches },
      burst_iterations: burstIterations,
      schedule: {
        ...scheduleCfg,
        active_windows: [{ days: scheduleDays, start: scheduleStart, end: scheduleEnd }],
        timezone: scheduleTimezone,
      },
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
  const labelCls = 'block text-sm text-text-muted mb-1';

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-lg">
      {/* Env errors */}
      {envCheck && envCheck.errors.length > 0 && (
        <div className="rounded border border-red-500/50 bg-red-500/10 p-3 space-y-1">
          {envCheck.errors.map((e, i) => (
            <p key={i} className="text-sm text-red-400 flex items-start gap-1.5 font-medium">
              <Icon name="close" size="xs" className="mt-0.5 shrink-0" />{e}
            </p>
          ))}
        </div>
      )}
      {envCheck && envCheck.warnings.length > 0 && (
        <div className="rounded border border-yellow-500/30 bg-yellow-500/10 p-3 space-y-1">
          {envCheck.warnings.map((w, i) => (
            <p key={i} className="text-sm text-yellow-400 flex items-start gap-1.5">
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
        <p className="text-sm text-text-muted uppercase tracking-wide mb-3">Provider</p>
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
                : <span className="text-sm text-text-muted/60">Uses ANTHROPIC_API_KEY env var</span>}
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
        <p className="text-sm text-text-muted uppercase tracking-wide mb-3">Search</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} title="How many follow-up levels deep to explore. Each level spawns new threads from the previous level's findings.">Max thread depth</label>
            <input type="number" min={1} max={20} value={maxDepth} onChange={e => setMaxDepth(Number(e.target.value))} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} title="Hard cap on total threads created for this query. Prevents runaway branching. 0 = unlimited.">Max total threads</label>
            <input type="number" min={0} max={2000} step={50} value={maxTotalThreads} onChange={e => setMaxTotalThreads(Number(e.target.value))} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} title="Minimum web searches per thread before synthesis.">Min searches per thread</label>
            <input type="number" min={1} max={10} value={minSearches} onChange={e => setMinSearches(Number(e.target.value))} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} title="How many threads can run simultaneously.">Concurrent threads</label>
            <input type="number" min={1} max={10} value={maxConcurrentThreads} onChange={e => setMaxConcurrentThreads(Number(e.target.value))} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} title="Maximum LLM calls per hour across all threads. Reduces API costs and rate-limit errors.">Max steps / hour</label>
            <input type="number" min={1} max={200} value={maxStepsPerHour} onChange={e => setMaxStepsPerHour(Number(e.target.value))} className={inputCls} />
          </div>
        </div>
      </div>

      {/* Exploration */}
      <div>
        <p className="text-sm text-text-muted uppercase tracking-wide mb-3">Exploration</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} title="Base probability that a completed thread spawns a serendipitous tangent using a random perturbation strategy. Decreases with depth.">Serendipity (0–1)</label>
            <input type="number" min={0} max={1} step={0.05} value={pSerendipity} onChange={e => setPSerendipity(Number(e.target.value))} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} title="Min follow-up questions generated per finding.">Follow-ups min</label>
            <input type="number" min={0} max={10} value={followUpMin} onChange={e => setFollowUpMin(Number(e.target.value))} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} title="Max follow-up questions generated per finding.">Follow-ups max</label>
            <input type="number" min={1} max={20} value={followUpMax} onChange={e => setFollowUpMax(Number(e.target.value))} className={inputCls} />
          </div>
        </div>
      </div>

      {/* Topic Coherence */}
      <div>
        <p className="text-sm text-text-muted uppercase tracking-wide mb-3">Topic Coherence</p>
        <p className="text-sm text-text-muted mb-3">Jaccard similarity gates to prevent topic drift. 0 = disabled (allow any follow-up).</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} title="Minimum token overlap between each follow-up and the original seed query. Catches gradual drift away from the starting topic. Start with 0.05–0.10 to prune only extreme outliers.">Seed similarity floor</label>
            <input type="number" min={0} max={1} step={0.01} value={seedSimilarityMin} onChange={e => setSeedSimilarityMin(Number(e.target.value))} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} title="Minimum token overlap between each follow-up and its parent thread. Catches sudden single-hop lurches into unrelated territory. Start with 0.10–0.20.">Per-hop similarity floor</label>
            <input type="number" min={0} max={1} step={0.01} value={hopSimilarityMin} onChange={e => setHopSimilarityMin(Number(e.target.value))} className={inputCls} />
          </div>
        </div>
      </div>

      {/* Source text */}
      <div>
        <p className="text-sm text-text-muted uppercase tracking-wide mb-3">Source Text</p>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={fetchSourceText} onChange={e => setFetchSourceText(e.target.checked)}
            className="w-4 h-4 accent-accent mt-0.5" />
          <div>
            <span className="text-sm text-text-primary">Fetch source page text</span>
            <div className="mt-1 flex flex-col gap-1">
              {envCheck ? (
                <>
                  <span className="text-sm text-text-muted">Page extractor: {' '}
                    <EnvBadge set={envCheck.jina} label={envCheck.jina ? 'Jina (active)' : 'JINA_API_KEY'} />
                    {!envCheck.jina && <span className="text-sm text-red-400 ml-1 font-medium">-- will throw, no fallback</span>}
                  </span>
                  <span className="text-sm text-text-muted">Search: {' '}
                    {envCheck.searchProvider === 'tavily' && <EnvBadge set={true} label="Tavily (active)" />}
                    {envCheck.searchProvider === 'brave' && <EnvBadge set={true} label="Brave (active)" />}
                    {envCheck.searchProvider === 'duckduckgo' && (
                      <><EnvBadge set={false} label="TAVILY_API_KEY" /><span className="text-sm text-text-muted ml-1">-- falling back to DuckDuckGo</span></>
                    )}
                  </span>
                </>
              ) : (
                <span className="text-sm text-text-muted">requires JINA_API_KEY -- no fallback</span>
              )}
            </div>
          </div>
        </label>
      </div>

      {/* Gap analysis */}
      <div>
        <p className="text-sm text-text-muted uppercase tracking-wide mb-3">Gap Analysis</p>
        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={gapEnabled} onChange={e => setGapEnabled(e.target.checked)}
              className="w-4 h-4 accent-accent" />
            <span className="text-sm text-text-primary">Enabled</span>
            <span className="text-sm text-text-muted">(runs a second LLM pass to find missing information)</span>
          </label>
          {gapEnabled && (
            <div className="max-w-[160px]">
              <label className={labelCls}>Max gap searches</label>
              <input type="number" min={1} max={5} value={maxGapSearches} onChange={e => setMaxGapSearches(Number(e.target.value))} className={inputCls} />
            </div>
          )}
        </div>
      </div>

      {/* Schedule */}
      <div>
        <p className="text-sm text-text-muted uppercase tracking-wide mb-3">Schedule</p>
        <div className="space-y-3">
          <div className="max-w-[160px]">
            <label className={labelCls}>Burst iterations</label>
            <input type="number" min={1} max={999} value={burstIterations} onChange={e => setBurstIterations(Math.max(1, parseInt(e.target.value) || 10))} className={inputCls} />
          </div>
          <p className="text-sm text-text-muted">Window for scheduled mode — days and times when the engine is allowed to run.</p>
          <div className="flex items-center gap-1 flex-wrap">
            {(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map(day => (
              <button
                key={day} type="button"
                onClick={() => setScheduleDays(prev =>
                  prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
                )}
                className={clsx(
                  'px-2 py-0.5 text-sm rounded-md font-medium transition-colors capitalize',
                  scheduleDays.includes(day)
                    ? 'bg-accent text-white'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary border border-border-primary'
                )}
              >{day}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="time" value={scheduleStart} onChange={e => setScheduleStart(e.target.value)}
              className="bg-bg-primary border border-border-primary rounded px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent" />
            <span className="text-sm text-text-muted">—</span>
            <input type="time" value={scheduleEnd} onChange={e => setScheduleEnd(e.target.value)}
              className="bg-bg-primary border border-border-primary rounded px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className={labelCls}>Timezone</label>
            <input type="text" value={scheduleTimezone} onChange={e => setScheduleTimezone(e.target.value)}
              className={inputCls} placeholder="e.g. America/Los_Angeles" />
          </div>
        </div>
      </div>

      {/* Budget */}
      <div>
        <p className="text-sm text-text-muted uppercase tracking-wide mb-3">Budget</p>
        <div className="max-w-[160px]">
          <label className={labelCls}>Daily limit (USD)</label>
          <input type="number" min={0} step={0.5} value={budgetDaily} onChange={e => setBudgetDaily(Number(e.target.value))} className={inputCls} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={updateConfig.isPending}>Save</Button>
        {saved && <span className="text-sm text-green-400">Saved</span>}
      </div>

      {/* Delete */}
      <div className="pt-4 border-t border-border-primary">
        {deleteConfirm ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">Delete this query permanently?</span>
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
  const { data: workers = [] } = useResearchWorkers();
  const updateQuery = useUpdateResearchQuery();
  const updateConfig = useUpdateQueryConfig();
  const runResearch = useRunResearch();
  const cancelJob = useCancelJob();
  const deleteQuery = useDeleteResearchQuery();

  const [tab, setTab] = useState<'document' | 'live' | 'map' | 'knowledge' | 'sources' | 'config' | 'settings'>('document');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const scheduleCfg = (session?.config?.schedule) as Record<string, unknown> | undefined;

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
  const activeJob = activeJobs[0] ?? null;

  const isEnabled = session.status === 'active';
  const selectedMode = activeJob?.mode ?? (scheduleCfg?.mode as string) ?? 'background';

  function cancelAll() { for (const j of activeJobs) cancelJob.mutate({ jobId: j.id }); }

  function setRunMode(mode: 'burst' | 'background' | 'scheduled') {
    updateConfig.mutate({ id: id!, config: { schedule: { ...(scheduleCfg as object), mode } } });
  }

  function handleToggleEnabled() {
    if (isEnabled) {
      updateQuery.mutate({ id: id!, status: 'paused' });
      cancelAll();
    } else {
      updateQuery.mutate({ id: id!, status: 'active' });
      if (selectedMode === 'burst') {
        const iterations = (session!.config as Record<string, unknown>).burst_iterations as number ?? 10;
        runResearch.mutate({ sessionId: id!, mode: 'burst', iterations });
      } else if (selectedMode === 'background') {
        runResearch.mutate({ sessionId: id!, mode: 'background' });
      }
      // scheduled: worker picks it up automatically when windows are active
    }
  }

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Header bar */}
        <div className="border-b border-border-primary bg-bg-primary shrink-0">
          {/* Title row — h-14 matches sidebar "Construct" header height */}
          <div className="h-14 flex items-center justify-between px-6">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Link to="/research" className="font-heading text-2xl font-bold text-text-muted hover:text-text-primary whitespace-nowrap shrink-0 leading-none">Research Sessions</Link>
              <span className="font-heading text-2xl font-bold text-text-muted shrink-0 leading-none">&raquo;</span>
              <h1 className="font-heading text-2xl font-bold text-text-primary truncate min-w-0 leading-none">{session.title}</h1>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-4">
              {/* Run mode controls */}
              <div className="flex items-center gap-1">
                {(['burst', 'background', 'scheduled'] as const).map(m => (
                  <button key={m} onClick={() => setRunMode(m)}
                    className={clsx('rounded-md px-2.5 py-1 text-sm font-medium transition-colors capitalize',
                      selectedMode === m ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
                    )}
                  >{m}</button>
                ))}
                <button onClick={handleToggleEnabled}
                  className={clsx('rounded-md px-2.5 py-1 text-sm font-medium transition-colors ml-1',
                    isEnabled ? 'bg-success/20 text-success hover:bg-success/30' : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary border border-border-primary'
                  )}
                >{isEnabled ? 'Enabled' : 'Enable'}</button>
              </div>
              {deleteConfirm ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-text-muted">Delete?</span>
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

          {/* Secondary content */}
          <div className="px-6 pb-0">
            <p className="text-sm text-text-muted line-clamp-3 mb-2">{session.seed_query_short || session.seed_query}</p>

          {/* Env warnings */}
          {envCheck && (envCheck.errors.length > 0 || envCheck.warnings.length > 0 || envCheck.jina_balance !== null) && (
            <div className="flex flex-col gap-1.5 mt-3">
              {envCheck.errors.map((e, i) => (
                <div key={i} className="rounded border border-red-500/50 bg-red-500/10 px-3 py-1.5 flex items-center gap-2">
                  <Icon name="close" size="xs" className="text-red-400 shrink-0" />
                  <span className="text-sm text-red-400 font-medium">{e}</span>
                </div>
              ))}
              {envCheck.warnings.map((w, i) => (
                <div key={i} className="rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 flex items-center gap-2">
                  <span className="text-yellow-400 text-sm shrink-0">&#x26a0;</span>
                  <span className="text-sm text-yellow-400">{w}</span>
                </div>
              ))}
              {envCheck.jina_balance !== null && (
                <div className="rounded border border-border-primary bg-bg-secondary px-3 py-1.5 flex items-center gap-2">
                  <span className="text-sm text-text-muted">Jina balance:</span>
                  <span className={`text-sm font-medium tabular-nums ${envCheck.jina_balance < 100_000 ? 'text-red-400' : envCheck.jina_balance < 1_000_000 ? 'text-yellow-400' : 'text-green-400'}`}>
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
                <span className="text-sm text-text-muted">{stat.label}:</span>
                <span className="text-sm font-semibold text-text-primary tabular-nums">{stat.value}</span>
              </div>
            ))}
            {workers.length > 0 && (
              <span className="text-sm text-text-muted">
                {workers.filter(w => w.status !== 'stopped').length} workers
              </span>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 mt-3 -mb-px relative z-10">
            {([
              { key: 'document' as const, label: `Document (${findingsData.length})` },
              { key: 'live' as const, label: `Live (${threadsData.length})` },
              { key: 'map' as const, label: `Map` },
              { key: 'knowledge' as const, label: 'Knowledge' },
              { key: 'sources' as const, label: 'Sources' },
              { key: 'config' as const, label: 'Config' },
              { key: 'settings' as const, label: 'Settings' },
            ]).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={clsx('px-3 py-2 text-sm font-medium border-b-2 transition-colors',
                  tab === t.key ? 'border-accent text-accent bg-bg-primary' : 'border-transparent text-text-muted hover:text-text-secondary')}>
                {t.label}
              </button>
            ))}
          </div>
          </div>{/* end secondary content */}
        </div>

        {/* Tab content */}
        {tab === 'live' ? (
          <div className="flex-1 overflow-hidden min-h-0">
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
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {tab === 'document' && (
              <DocumentView
                findings={findingsData}
                threads={threadsData}
                onNavigateToThread={navigateToThread}
                onNavigateToMap={navigateToMap}
                document={session?.document || undefined}
                sessionId={id!}
                title={session?.title}
              />
            )}
            {tab === 'map' && (
              <MapView
                threads={threadsData}
                findingCounts={findingCounts}
                onNavigateToLive={navigateToThread}
              />
            )}
            {tab === 'knowledge' && (
              <KnowledgeView sessionId={id!} />
            )}
            {tab === 'sources' && (
              <SourcesView sessionId={id!} />
            )}
            {tab === 'config' && (
              <SessionConfigView session={session} sessionId={id!} />
            )}
            {tab === 'settings' && (
              <SettingsView
                session={session}
                sessionId={id!}
                onDelete={() => deleteQuery.mutate({ id: id! }, { onSuccess: () => { window.location.href = '/research/queries'; } })}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
