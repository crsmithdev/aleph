import { Icon } from '../../components/ui/Icon';
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  useResearchQuery, useResearchFindings, useResearchThreads,
  useResearchCosts, useUpdateResearchQuery, usePromoteResearchQuery, useRateFinding,
  usePostMortems,
  useRunResearch, useResearchRunning,
  useResearchActivity, useCancelJob, useResearchJobs, useResearchStream,
  useResearchSteps, useUpdateThread, useDeleteResearchQuery, useUpdateQueryConfig,
  useResearchEnvCheck, useRedoThread,
  useGenerateDocument, useResearchWorkers, useResearchDefaults,
  useConcepts, useConceptLinks, useConceptDetail,
  useSources, useRetrySource, useSkipSource,
  type ResearchFinding, type ResearchThread, type ResearchActivity,
  type ResearchJob, type StreamEvent, type ResearchStep,
  type ConceptWithStats, type ConceptLink,
  type Source, type SourceExtractionStatus,
} from '../../api/research-hooks';
import { Button } from '../../components/ui/Button';
import { PageTitle, PageTitleLink, PageTitleSeparator } from '../../components/layout/PageHeader';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { ConfigForm, patchByPath, getByPath } from './config-schema';
import { ResearchActivityView } from './ResearchActivityView';
import { ResearchGraphView } from './ResearchGraphView';
import { FlagChip } from '../../components/research/FlagChip';
import { QuestionShapeBar } from '../../components/research/QuestionShapeBar';
import cytoscape from 'cytoscape';
// @ts-expect-error cytoscape-fcose has no bundled types
import fcose from 'cytoscape-fcose';

cytoscape.use(fcose);

// suppress unused import warnings — available for future use
void (useRateFinding as unknown);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function orderThreadsDepthFirst(threads: ResearchThread[]): ResearchThread[] {
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
export function findSeedAncestor(thread: ResearchThread, all: ResearchThread[]): string | null {
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

function Md({ children, className }: { children: string; className?: string }) {
  if (!children || typeof children !== 'string') return null;
  return (
    <div className={['md-content', className].filter(Boolean).join(' ')}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}



// ---------------------------------------------------------------------------
// Left Sidebar — Thread Navigator
// ---------------------------------------------------------------------------

interface ParsedSection {
  headingTitle: string;
  headingId: string;
  headingLevel: number;
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

function conceptSlug(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function FactBox({ raw }: { raw: string }) {
  const rows = raw.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const eq = trimmed.indexOf('=');
    if (eq < 0) return { term: trimmed, value: '' };
    return { term: trimmed.slice(0, eq).trim(), value: trimmed.slice(eq + 1).trim() };
  }).filter((r): r is { term: string; value: string } => r !== null && r.term.length > 0);

  if (rows.length === 0) return null;

  return (
    <div className="bg-bg-secondary border border-border-primary/40 rounded-lg px-4 py-3 my-4">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map((r, i) => (
          <React.Fragment key={i}>
            <dt className="text-text-muted uppercase tracking-[0.04em] text-sm font-medium">{r.term}</dt>
            <dd className="text-text-primary font-mono tabular-nums">{r.value}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
}

function DocumentView({
  findings, threads, onNavigateToConcept, document, sessionId, title,
}: {
  findings: ResearchFinding[];
  threads: ResearchThread[];
  onNavigateToConcept: (name: string) => void;
  document?: string;
  sessionId: string;
  title?: string;
}) {
  const generateDoc = useGenerateDocument();

  const hasFindings = findings.length >= 3;

  // Strip markdown code fences; normalize GFM-footnote [^N] → [N]; rewrite
  // [[Concept]] wiki-links into concept: anchors. Footnote normalization runs
  // before anything else because some generations mix [N] and [^N] forms and
  // we want a single downstream representation.
  const cleanDoc = useMemo(() => {
    if (!document) return '';
    const stripped = document.replace(/^```(?:markdown)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
    const footnotesNormalized = stripped.replace(/\[\^(\d+)\]/g, '[$1]');
    return footnotesNormalized.replace(/\[\[([^\[\]\n]+?)\]\]/g, (_m, name: string) => {
      const trimmed = name.trim();
      return `[${trimmed}](#concept:${conceptSlug(trimmed)})`;
    });
  }, [document]);

  // Parse document into sections for per-section metadata + TOC.
  const allSections = useMemo(() => parseDocumentSections(cleanDoc), [cleanDoc]);

  // Compute used citations from body sections (everything except "## References").
  const bodySections = useMemo(
    () => allSections.filter(s => s.headingTitle.trim().toLowerCase() !== 'references'),
    [allSections],
  );
  const usedCitations = useMemo(() => {
    const s = new Set<number>();
    for (const sec of bodySections) for (const n of sec.citationNums) s.add(n);
    return s;
  }, [bodySections]);

  // Drop the auto-generated "## References" section ONLY when the body has
  // real inline citations — the rail then owns the references. If the body
  // has no [N] markers, the doc's own References section is the only place
  // the reader sees sources, so leave it intact.
  const docSections = useMemo(
    () => (usedCitations.size > 0 ? bodySections : allSections),
    [allSections, bodySections, usedCitations],
  );

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

  // Back-link each citation number to the sections that cite it.
  const sectionsByCitation = useMemo(() => {
    const m = new Map<number, Array<{ id: string; title: string }>>();
    for (const sec of bodySections) {
      if (sec.headingLevel < 2) continue;
      for (const n of sec.citationNums) {
        const list = m.get(n) ?? [];
        if (!list.some(e => e.id === sec.headingId)) {
          list.push({ id: sec.headingId, title: sec.headingTitle });
        }
        m.set(n, list);
      }
    }
    return m;
  }, [bodySections]);

  function scrollToHeading(id: string) {
    const el = window.document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Rebuild a slim References section from only-used citations, so the
  // downloaded .md no longer carries the full 500-entry tail. The citation
  // index is URL-based — same ordering the backend uses — so numbers match
  // the [N] markers in the prose.
  function exportMarkdown() {
    if (!cleanDoc) return;
    const bodyOnly = docSections
      .map(s => {
        const heading = s.headingLevel >= 2 ? `${'#'.repeat(s.headingLevel)} ${s.headingTitle}\n` : '';
        return heading + (s.content ?? '');
      })
      .join('\n')
      .trim();

    const urlByNumber = new Map<number, { url: string; title: string }>();
    let next = 1;
    for (const f of findings) {
      const metaByUrl = new Map((f.source_url_meta ?? []).map(m => [m.url, m] as const));
      for (const url of f.source_urls) {
        if ([...urlByNumber.values()].some(v => v.url === url)) continue;
        urlByNumber.set(next++, { url, title: metaByUrl.get(url)?.title || f.summary || url });
      }
    }

    const refLines: string[] = [];
    [...usedCitations].sort((a, b) => a - b).forEach(n => {
      const entry = urlByNumber.get(n);
      if (!entry) return;
      refLines.push(`${n}. [${entry.title}](${entry.url})`);
    });
    const refsSection = refLines.length ? `\n\n## References\n\n${refLines.join('\n')}\n` : '';
    const blob = new Blob([bodyOnly + refsSection], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${(title || sessionId).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
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

  const showRail = usedCitations.size > 0;
  const gridCols = showRail
    ? 'xl:grid-cols-[200px_minmax(0,1fr)_300px]'
    : 'xl:grid-cols-[200px_minmax(0,1fr)]';

  return (
    <div className={clsx('grid grid-cols-1 gap-7', gridCols)}>
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
                  const isCitation = href?.startsWith('#ref-');
                  const isConcept = href?.startsWith('#concept:');
                  if (isConcept) {
                    const label = typeof children === 'string' ? children : React.Children.toArray(children).map(c => typeof c === 'string' ? c : '').join('');
                    return (
                      <a
                        href={href}
                        onClick={(e) => {
                          e.preventDefault();
                          onNavigateToConcept(label.trim());
                        }}
                        className="text-info border-b border-dotted border-info/60 hover:border-info cursor-pointer"
                      >
                        {children}
                      </a>
                    );
                  }
                  return (
                    <a
                      {...rest}
                      href={href}
                      {...(!isCitation ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      onClick={isCitation ? (e) => {
                        e.preventDefault();
                        const el = window.document.getElementById(href!.slice(1));
                        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      } : undefined}
                      className={clsx('hover:underline', isCitation ? 'text-text-muted text-sm font-mono' : 'text-accent')}
                    >
                      {children}
                    </a>
                  );
                },
                blockquote: ({ children }: React.HTMLAttributes<HTMLElement>) => (
                  <blockquote className="border-l-[3px] border-accent pl-4 pr-3 py-2 my-4 rounded-r-md bg-bg-secondary text-text-secondary italic">{children}</blockquote>
                ),
                code: ({ className, children, ...rest }: React.HTMLAttributes<HTMLElement> & { className?: string }) => {
                  if (className === 'language-facts') {
                    return <FactBox raw={String(children).replace(/\n$/, '')} />;
                  }
                  return <code className={clsx(className, 'px-1 py-0.5 rounded bg-bg-tertiary text-sm font-mono')} {...rest}>{children}</code>;
                },
                pre: ({ children }: React.HTMLAttributes<HTMLPreElement>) => {
                  // If the inner code is a fact-box, render it unwrapped (no <pre>).
                  const child = React.Children.toArray(children)[0] as React.ReactElement<{ className?: string }> | undefined;
                  if (child && React.isValidElement(child) && child.props?.className === 'language-facts') {
                    return <>{child}</>;
                  }
                  return <pre className="bg-bg-secondary border border-border-primary/30 rounded-md p-3 my-4 overflow-x-auto text-sm">{children}</pre>;
                },
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

      {/* Right bibliography rail — only when the body has citations to link */}
      {showRail && (
        <aside className="hidden xl:block">
          <div className="sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
            <BibliographyRail
              findings={findings}
              sessionId={sessionId}
              usedCitations={usedCitations}
              sectionsByCitation={sectionsByCitation}
            />
          </div>
        </aside>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bibliography rail (right side of Document view)
// ---------------------------------------------------------------------------

export function domainFrom(url: string): string {
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
  usedCitations,
  sectionsByCitation,
}: {
  findings: ResearchFinding[];
  sessionId: string;
  usedCitations: Set<number>;
  sectionsByCitation: Map<number, Array<{ id: string; title: string }>>;
}) {
  const { data: sourcesData } = useSources(sessionId);
  const sourceByUrl = useMemo(() => {
    const m = new Map<string, Source>();
    for (const s of sourcesData?.items ?? []) m.set(s.url, s);
    return m;
  }, [sourcesData]);

  // Build URL → citation number index in the same order the backend uses
  // (iterate findings in incoming order, assign incrementing numbers to each
  // new URL). The backend's buildCitationIndex walks findings the same way,
  // so the numbers line up with the [N] markers in the document.
  const items = useMemo(() => {
    const urlToNumber = new Map<string, number>();
    const titleForUrl = new Map<string, string>();
    const findingForUrl = new Map<string, ResearchFinding>();
    let next = 1;
    for (const f of findings) {
      const metaByUrl = new Map((f.source_url_meta ?? []).map(m => [m.url, m] as const));
      for (const url of f.source_urls) {
        if (urlToNumber.has(url)) continue;
        urlToNumber.set(url, next++);
        titleForUrl.set(url, metaByUrl.get(url)?.title || f.summary || url);
        findingForUrl.set(url, f);
      }
    }

    const rows: Array<{
      index: number;
      url: string;
      title: string;
      href: string;
      domain: string;
      confidence: number;
      status?: SourceExtractionStatus;
      sections: Array<{ id: string; title: string }>;
      key: string;
    }> = [];
    for (const [url, index] of urlToNumber.entries()) {
      if (!usedCitations.has(index)) continue;
      const title = titleForUrl.get(url) ?? url;
      const src = sourceByUrl.get(url);
      const f = findingForUrl.get(url);
      rows.push({
        index,
        url,
        title,
        href: url,
        domain: domainFrom(url),
        confidence: f?.confidence ?? 0,
        status: src?.extraction_status as SourceExtractionStatus | undefined,
        sections: sectionsByCitation.get(index) ?? [],
        key: `${index}-${url}`,
      });
    }
    rows.sort((a, b) => a.index - b.index);
    return rows;
  }, [findings, sourceByUrl, usedCitations, sectionsByCitation]);

  function scrollToSection(id: string) {
    const el = window.document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div>
      <h4 className="text-sm text-text-muted font-medium uppercase tracking-[0.08em] mb-2.5">
        References &middot; {items.length}
      </h4>
      <div>
        {items.map(({ key, index, title, href, domain, confidence, status, sections }) => (
          <div
            key={key}
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
            {(domain || confidence > 0) && (
              <div className="text-sm text-text-muted mt-0.5">
                {domain}
                {domain && <span className="mx-1">&middot;</span>}
                <span>{(confidence * 100).toFixed(0)}% conf</span>
              </div>
            )}
            {sections.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {sections.map(s => (
                  <button
                    key={s.id}
                    onClick={() => scrollToSection(s.id)}
                    className="text-sm text-info hover:underline"
                    title={`Cited in "${s.title}"`}
                  >
                    ↑ {s.title}
                  </button>
                ))}
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


export function LiveView({
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
  const [expandedFindingId, setExpandedFindingId] = useState<string | null>(null);
  const [findingsSearch, setFindingsSearch] = useState('');
  const [threadSearch, setThreadSearch] = useState('');
  const [threadPanelWidth, setThreadPanelWidth] = useState(260);

  const startResizeThread = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = threadPanelWidth;
    const onMove = (ev: MouseEvent) => setThreadPanelWidth(Math.max(180, Math.min(420, startW + ev.clientX - startX)));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const stepsByThread = useMemo(() => {
    const map = new Map<string, ResearchStep[]>();
    const seen = new Set<string>();
    for (const s of allSteps) {
      if (s.thread_id === null) continue; // session-scope steps don't bucket under a thread
      const arr = map.get(s.thread_id) ?? [];
      arr.push(s);
      map.set(s.thread_id, arr);
      seen.add(s.id);
    }
    for (const e of events) {
      if (e.type !== 'step') continue;
      if (seen.has(e.payload.id)) continue;
      if (e.payload.thread_id === null) continue;
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
                className={clsx(
                  'pl-3 pr-3 pt-1.5 pb-1.5 border-b border-border-primary border-l-4 group hover:bg-bg-tertiary transition-colors',
                  liveStatusBorder[thread.status] ?? 'border-l-text-muted/30'
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
      {/* ── Pane 2: Findings (right) ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
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

export function MapView({
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
            'font-size': '14px',
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


function formatFetched(iso: string | null | undefined): string {
  if (!iso) return '-';
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 172800) return 'yesterday';
  return `${Math.floor(secs / 86400)}d ago`;
}

function kbSize(n: number): string {
  if (n < 1024) return `${n}b`;
  return `${Math.round(n / 1024)}kB`;
}

function SourceExtractionPill({ src }: { src: Source }) {
  const s = src.extraction_status;
  const base = 'inline-flex items-center text-sm px-2 py-[1px] border rounded whitespace-nowrap';
  if (s === 'extracted') {
    const size = src.extracted_text ? ` · ${kbSize(src.extracted_text.length)}` : '';
    return (
      <span className={clsx(base, 'bg-success/15 text-success border-success/30')}>
        extracted{size}
      </span>
    );
  }
  if (s === 'failed') {
    const label = src.error ? `${src.error.slice(0, 12)} · retry` : 'failed · retry';
    return (
      <span className={clsx(base, 'bg-error/15 text-error border-error/30')}>
        {label}
      </span>
    );
  }
  if (s === 'claimed') {
    return (
      <span className={clsx(base, 'bg-warning/15 text-warning border-warning/30')}>
        extracting&hellip;
      </span>
    );
  }
  if (s === 'skipped') {
    return (
      <span className={clsx(base, 'bg-bg-tertiary text-text-muted border-border-primary/30')}>
        snippet only
      </span>
    );
  }
  return (
    <span className={clsx(base, 'bg-warning/15 text-warning border-warning/30')}>
      pending
    </span>
  );
}

function SourcesView({ sessionId, onNavigateToTelemetry }: { sessionId: string; onNavigateToTelemetry?: () => void }) {
  const { data, isLoading } = useSources(sessionId);
  const { data: findings } = useResearchFindings(sessionId);
  const retry = useRetrySource();
  const skip = useSkipSource();
  const [busy, setBusy] = useState(false);

  const findingsByUrl = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of findings ?? []) {
      const urls = f.source_url_meta?.length ? f.source_url_meta.map(s => s.url) : f.source_urls;
      for (const u of urls) m.set(u, (m.get(u) ?? 0) + 1);
    }
    return m;
  }, [findings]);

  if (isLoading) return <PageLoading />;
  const items: Source[] = data?.items ?? [];
  const counts = data?.counts ?? { pending: 0, extracted: 0, failed: 0, skipped: 0 };
  const total = counts.pending + counts.extracted + counts.failed + counts.skipped;
  const inProgress = items.filter(s => s.extraction_status === 'claimed').length;

  async function retryAllFailed() {
    setBusy(true);
    try {
      for (const s of items.filter(s => s.extraction_status === 'failed')) {
        await retry.mutateAsync({ sourceId: s.id, sessionId });
      }
    } finally { setBusy(false); }
  }

  async function extractAllSnippetOnly() {
    setBusy(true);
    try {
      for (const s of items.filter(s => s.extraction_status === 'skipped')) {
        await retry.mutateAsync({ sourceId: s.id, sessionId });
      }
    } finally { setBusy(false); }
  }

  return (
    <div>
      {/* Stats + bulk-action header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-5 text-sm">
          <span><span className="text-text-primary font-medium tabular-nums">{total}</span>{' '}<span className="text-text-muted">total</span></span>
          <span><span className="text-success font-medium tabular-nums">{counts.extracted}</span>{' '}<span className="text-text-muted">extracted</span></span>
          <span><span className="text-warning font-medium tabular-nums">{counts.skipped}</span>{' '}<span className="text-text-muted">snippet only</span></span>
          <span><span className="text-info font-medium tabular-nums">{inProgress}</span>{' '}<span className="text-text-muted">in progress</span></span>
          <span><span className="text-error font-medium tabular-nums">{counts.failed}</span>{' '}<span className="text-text-muted">failed</span></span>
          {onNavigateToTelemetry && counts.failed > 0 && (
            <button
              onClick={onNavigateToTelemetry}
              className="text-sm text-text-muted hover:text-accent underline decoration-dotted"
              title="See failure reasons and failing domains in Telemetry"
            >
              failure breakdown ↗
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={extractAllSnippetOnly} disabled={busy || counts.skipped === 0}>
            Extract all (snippet only)
          </Button>
          <Button size="sm" variant="secondary" onClick={retryAllFailed} disabled={busy || counts.failed === 0}>
            Retry failed
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="border border-border-primary/40 rounded bg-bg-primary overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <colgroup>
            <col style={{ width: '40%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '6%' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-border-primary/40 text-text-muted text-left">
              <th className="font-medium px-3 py-2">Source</th>
              <th className="font-medium px-3 py-2">Extraction</th>
              <th className="font-medium px-3 py-2">Concepts linked</th>
              <th className="font-medium px-3 py-2 text-right">Findings</th>
              <th className="font-medium px-3 py-2">Fetched</th>
              <th className="font-medium px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-text-muted">
                  No sources registered for this query yet.
                </td>
              </tr>
            ) : items.map(src => {
              const findingCount = findingsByUrl.get(src.url) ?? 0;
              const canExtract = src.extraction_status === 'skipped' || src.extraction_status === 'failed';
              const canSkip = src.extraction_status === 'pending' || src.extraction_status === 'claimed';
              const action = canExtract ? 'extract' : canSkip ? 'skip' : 'open';
              return (
                <tr key={src.id} className="border-b border-border-primary/30 last:border-b-0 align-top">
                  <td className="px-3 py-2.5">
                    <div className="text-text-primary font-medium truncate" title={src.title || undefined}>
                      {src.title || domainFrom(src.url)}
                    </div>
                    <div className="text-sm text-text-muted truncate" title={src.url}>
                      {src.url.replace(/^https?:\/\//, '')}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <SourceExtractionPill src={src} />
                  </td>
                  <td className="px-3 py-2.5 text-text-muted">
                    <span className="text-sm">&mdash;</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                    {findingCount}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-text-muted">
                    {formatFetched(src.fetched_at ?? src.updated_at)}
                  </td>
                  <td className="px-3 py-2.5 text-sm">
                    {action === 'extract' && (
                      <button
                        onClick={() => retry.mutate({ sourceId: src.id, sessionId })}
                        disabled={retry.isPending}
                        className="text-accent hover:underline disabled:opacity-50"
                      >
                        extract
                      </button>
                    )}
                    {action === 'skip' && (
                      <button
                        onClick={() => skip.mutate({ sourceId: src.id, sessionId })}
                        disabled={skip.isPending}
                        className="text-text-muted hover:text-text-secondary hover:underline disabled:opacity-50"
                      >
                        skip
                      </button>
                    )}
                    {action === 'open' && (
                      <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                        open
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type KnowledgeFilter = 'all' | 'hub' | 'recent';

type KnowledgeViewMode = 'graph' | 'split';

/** Level-of-detail tiers for the Knowledge view semantic-zoom slider.
 *  Limit is computed as a fraction of the total so small sessions don't feel gated. */
const KNOWLEDGE_LOD_TIERS: Array<{ level: 1 | 2 | 3 | 4; label: string; fraction: number | null; min: number }> = [
  { level: 1, label: 'Overview', fraction: 0.12, min: 6 },
  { level: 2, label: 'Clusters', fraction: 0.33, min: 14 },
  { level: 3, label: 'Detail',   fraction: 0.66, min: 24 },
  { level: 4, label: 'Full',     fraction: null, min: 0 },
];

export function KnowledgeView({
  sessionId,
  pendingConceptName,
  onConsumePending,
}: {
  sessionId: string;
  pendingConceptName?: string | null;
  onConsumePending?: () => void;
}) {
  const { data: concepts, isLoading } = useConcepts(sessionId);
  const { data: links } = useConceptLinks(sessionId);
  const [focusId, setFocusId] = useState<string | null>(null);
  const { data: detail } = useConceptDetail(sessionId, focusId);
  const [filter, setFilter] = useState<KnowledgeFilter>('all');
  const [viewMode, setViewMode] = useState<KnowledgeViewMode>('graph');
  const [detailLevel, setDetailLevel] = useState<1 | 2 | 3 | 4>(2);
  const [showGhosts, setShowGhosts] = useState(true);

  useEffect(() => {
    if (!pendingConceptName || !concepts || concepts.length === 0) return;
    const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const targetSlug = slugify(pendingConceptName);
    const match = concepts.find(c => slugify(c.canonical_name) === targetSlug)
      ?? concepts.find(c => c.aliases.some(a => slugify(a) === targetSlug));
    if (match) setFocusId(match.id);
    onConsumePending?.();
  }, [pendingConceptName, concepts, onConsumePending]);

  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const filteredConcepts = useMemo(() => {
    if (!concepts) return [];
    if (filter === 'hub') return concepts.filter(c => c.finding_count >= 3);
    if (filter === 'recent') {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      return concepts.filter(c => new Date(c.updated_at).getTime() >= cutoff);
    }
    return concepts;
  }, [concepts, filter]);

  // Semantic-zoom: rank by finding_count and keep top-N for the current tier.
  // Always keep the focused concept so the user can't "zoom away" from their own selection.
  const visibleConcepts = useMemo(() => {
    const tier = KNOWLEDGE_LOD_TIERS[detailLevel - 1];
    const total = filteredConcepts.length;
    if (tier.fraction == null) return filteredConcepts;
    const limit = Math.max(tier.min, Math.ceil(total * tier.fraction));
    if (limit >= total) return filteredConcepts;
    const ranked = [...filteredConcepts].sort((a, b) => b.finding_count - a.finding_count);
    const kept = new Set(ranked.slice(0, limit).map(c => c.id));
    if (focusId) kept.add(focusId);
    return filteredConcepts.filter(c => kept.has(c.id));
  }, [filteredConcepts, detailLevel, focusId]);

  // In split mode, the graph half only renders the focus + its 1-hop neighbourhood —
  // the outline is the primary nav and the graph is the context pane.
  const elements = useMemo((): cytoscape.ElementDefinition[] => {
    let displayConcepts = visibleConcepts;
    if (viewMode === 'split' && focusId) {
      const neighbourIds = new Set<string>([focusId]);
      for (const l of links ?? []) {
        if (l.from_concept_id === focusId) neighbourIds.add(l.to_concept_id);
        if (l.to_concept_id === focusId) neighbourIds.add(l.from_concept_id);
      }
      displayConcepts = visibleConcepts.filter(c => neighbourIds.has(c.id));
    }
    const nodes: cytoscape.ElementDefinition[] = displayConcepts.map(c => ({
      data: {
        id: c.id,
        label: c.canonical_name,
        findingCount: c.finding_count,
        sourceCount: c.source_count,
      },
    }));
    const byId = new Set(displayConcepts.map(c => c.id));
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
  }, [visibleConcepts, links, viewMode, focusId]);

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
          selector: 'node.focused',
          style: {
            'border-color': '#f9e2af',
            'border-width': 3,
            'background-color': '#f9e2af',
          } as cytoscape.Css.Node,
        },
        {
          selector: 'node.neighbor',
          style: {
            'border-color': '#f9e2af',
            'border-width': 2,
          } as cytoscape.Css.Node,
        },
        {
          selector: 'node.dimmed',
          style: { 'opacity': 0.22 } as cytoscape.Css.Node,
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
        {
          selector: 'edge.dimmed',
          style: { 'opacity': 0.15 } as cytoscape.Css.Edge,
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
      setFocusId(prev => prev === id ? null : id);
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) setFocusId(null);
    });

    cyRef.current = cy;

    // Re-fit on container resize so the graph stays centred when the parent
    // panel changes size (lens toggle in ResearchGraphView, window resize, etc).
    const observer = new ResizeObserver(() => {
      cy.resize();
      cy.fit(undefined, 30);
    });
    observer.observe(containerRef.current);

    return () => { observer.disconnect(); cy.destroy(); cyRef.current = null; };
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
      // fit:true makes the layout re-centre when elements change (important
      // when the user flips filters or the tier slider while the viewport
      // has already been panned/zoomed away).
      fit: true,
      padding: 30,
    } as cytoscape.LayoutOptions).run();
  }, [elements]);

  // Spotlight: highlight focus + 1-hop, dim everything else. When `showGhosts`
  // is off, nodes outside the neighbourhood are hidden rather than dimmed.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('focused neighbor dimmed highlighted');
    cy.elements().style('display', 'element');
    if (!focusId) return;
    const focus = cy.$id(focusId);
    if (focus.length === 0) return;
    focus.addClass('focused');
    const neighborhood = focus.closedNeighborhood();
    neighborhood.edges().addClass('highlighted');
    neighborhood.nodes().not(focus).addClass('neighbor');
    const others = cy.elements().difference(neighborhood);
    if (showGhosts) {
      others.addClass('dimmed');
    } else {
      others.style('display', 'none');
    }
  }, [focusId, showGhosts, elements]);

  if (isLoading) return <PageLoading />;
  if (!concepts || concepts.length === 0) {
    return (
      <div className="p-8 text-sm text-text-muted">
        No concepts have been extracted yet. Run the session for a few iterations — concepts are
        extracted from each finding after synthesis.
      </div>
    );
  }

  const chips: Array<{ key: KnowledgeFilter; label: string; n: number }> = [
    { key: 'all', label: 'All concepts', n: concepts.length },
    { key: 'hub', label: '≥3 findings', n: concepts.filter(c => c.finding_count >= 3).length },
    {
      key: 'recent',
      label: 'Updated 24h',
      n: concepts.filter(c => new Date(c.updated_at).getTime() >= Date.now() - 86_400_000).length,
    },
  ];

  const currentTier = KNOWLEDGE_LOD_TIERS[detailLevel - 1];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 h-[calc(100vh-240px)]">
      <div className="flex flex-col min-h-0">
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            {chips.map(c => (
              <button
                key={c.key}
                onClick={() => setFilter(c.key)}
                className={clsx(
                  'px-2.5 py-[3px] text-sm rounded border transition-colors inline-flex items-center gap-1.5',
                  filter === c.key
                    ? 'border-accent/40 text-accent bg-accent/10'
                    : 'border-border-primary/40 text-text-muted hover:text-text-secondary',
                )}
              >
                {c.label}
                <span className="text-sm tabular-nums opacity-70">{c.n}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-0.5 border border-border-primary/40 rounded p-0.5">
              {(['graph', 'split'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
                  className={clsx(
                    'px-2.5 py-[3px] text-xs uppercase tracking-[0.08em] rounded transition-colors',
                    viewMode === m
                      ? 'bg-accent/10 text-accent'
                      : 'text-text-muted hover:text-text-secondary',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            {viewMode === 'graph' && focusId && (
              <button
                onClick={() => setShowGhosts(v => !v)}
                className={clsx(
                  'px-2.5 py-[3px] text-xs uppercase tracking-[0.08em] rounded border transition-colors',
                  showGhosts
                    ? 'border-border-primary/40 text-text-muted hover:text-text-secondary'
                    : 'border-accent/40 text-accent bg-accent/10',
                )}
                title={showGhosts ? 'Hide non-neighbor nodes' : 'Show non-neighbor nodes (dimmed)'}
              >
                {showGhosts ? 'Spotlight' : 'Ghosts on'}
              </button>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-text-dim">Detail</span>
              <input
                type="range"
                min={1}
                max={4}
                step={1}
                value={detailLevel}
                onChange={(e) => setDetailLevel(Number(e.target.value) as 1 | 2 | 3 | 4)}
                className="accent-accent w-24"
              />
              <span className="text-[11px] font-mono text-text-muted tabular-nums min-w-[96px]">
                {currentTier.label} · {visibleConcepts.length}/{filteredConcepts.length}
              </span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => cyRef.current?.fit(undefined, 30)}>Fit</Button>
            <Button size="sm" variant="ghost"
              onClick={() => cyRef.current?.layout({ name: 'fcose', animate: true, animationDuration: 500 } as cytoscape.LayoutOptions).run()}
            >
              Relayout
            </Button>
          </div>
        </div>
        <div className={clsx(
          'flex-1 min-h-0 border border-border-primary/40 rounded bg-bg-secondary overflow-hidden grid',
          viewMode === 'split' ? 'grid-cols-[260px_1fr]' : 'grid-cols-1',
        )}>
          {viewMode === 'split' && (
            <ConceptOutline
              concepts={visibleConcepts}
              focusId={focusId}
              onSelect={setFocusId}
            />
          )}
          <div ref={containerRef} className={clsx('min-h-0 min-w-0', viewMode === 'split' && 'border-l border-border-primary/40')} />
        </div>
      </div>
      <aside className="flex flex-col gap-4 overflow-y-auto min-h-0">
        {focusId && detail ? (
          <ConceptInspector
            concept={detail}
            allLinks={links ?? []}
            allConcepts={concepts}
            onSelect={setFocusId}
            onClose={() => setFocusId(null)}
          />
        ) : (
          <ConceptList concepts={visibleConcepts} selectedId={focusId} onSelect={setFocusId} />
        )}
      </aside>
    </div>
  );
}

/** Outline pane for split-view: concepts grouped by finding-count tier, each row
 *  clickable to set the focus. Deliberately text-first — no icons, no decoration. */
function ConceptOutline({
  concepts, focusId, onSelect,
}: {
  concepts: ConceptWithStats[];
  focusId: string | null;
  onSelect: (id: string) => void;
}) {
  const groups = useMemo(() => {
    const hubs: ConceptWithStats[] = [];
    const frequent: ConceptWithStats[] = [];
    const mentioned: ConceptWithStats[] = [];
    for (const c of [...concepts].sort((a, b) => b.finding_count - a.finding_count)) {
      if (c.finding_count >= 5) hubs.push(c);
      else if (c.finding_count >= 2) frequent.push(c);
      else mentioned.push(c);
    }
    return [
      { key: 'hubs', label: 'Hubs · ≥5 findings', items: hubs },
      { key: 'frequent', label: 'Frequent · 2–4', items: frequent },
      { key: 'mentioned', label: 'Mentioned · 1', items: mentioned },
    ];
  }, [concepts]);

  return (
    <div className="overflow-y-auto text-sm">
      {groups.map(g => g.items.length > 0 && (
        <div key={g.key}>
          <div className="px-3 pt-3 pb-1 text-[10px] font-mono tracking-[0.14em] uppercase text-text-dim">
            {g.label}
          </div>
          {g.items.map(c => (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={clsx(
                'w-full text-left px-3 py-[5px] flex items-center justify-between border-l-2 transition-colors',
                focusId === c.id
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-transparent text-text-secondary hover:bg-white/3 hover:text-text',
              )}
            >
              <span className="truncate">{c.canonical_name}</span>
              <span className="text-[11px] font-mono tabular-nums opacity-60 ml-2 shrink-0">{c.finding_count}</span>
            </button>
          ))}
        </div>
      ))}
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

function ConceptInspector({
  concept, allLinks, allConcepts, onSelect, onClose,
}: {
  concept: import('../../api/research-hooks').ConceptDetail;
  allLinks: ConceptLink[];
  allConcepts: ConceptWithStats[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const related = useMemo(() => {
    const byId = new Map(allConcepts.map(c => [c.id, c]));
    const neighbors = new Set<string>();
    for (const link of allLinks) {
      if (link.from_concept_id === concept.id) neighbors.add(link.to_concept_id);
      else if (link.to_concept_id === concept.id) neighbors.add(link.from_concept_id);
    }
    return Array.from(neighbors).map(id => byId.get(id)).filter((c): c is ConceptWithStats => !!c);
  }, [allLinks, allConcepts, concept.id]);

  return (
    <div className="border border-border-primary/40 rounded bg-bg-secondary p-4 flex flex-col gap-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-text-primary truncate">{concept.canonical_name}</h3>
          {concept.aliases.length > 0 && (
            <div className="text-sm text-text-muted mt-0.5 truncate" title={concept.aliases.join(', ')}>
              aliases: {concept.aliases.join(' &middot; ')}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text-primary shrink-0 text-sm px-1"
          title="Close inspector"
        >
          &times;
        </button>
      </div>

      {/* Stat tiles */}
      <div className="flex gap-5">
        {[
          { n: concept.finding_count, l: 'findings' },
          { n: concept.sources.length, l: 'sources' },
          { n: related.length, l: 'related' },
        ].map(s => (
          <div key={s.l} className="flex flex-col">
            <span className="text-text-primary text-base font-semibold tabular-nums">{s.n}</span>
            <span className="text-sm text-text-muted uppercase tracking-[0.05em] mt-0.5">{s.l}</span>
          </div>
        ))}
      </div>

      {concept.summary && (
        <div>
          <h5 className="text-sm text-text-muted font-medium uppercase tracking-[0.08em] mb-1.5">Summary</h5>
          <p className="text-sm leading-snug text-text-secondary">{concept.summary}</p>
        </div>
      )}

      {concept.key_facts.length > 0 && (
        <div>
          <h5 className="text-sm text-text-muted font-medium uppercase tracking-[0.08em] mb-1.5">Key facts</h5>
          <ul className="list-disc pl-5 space-y-1 text-text-secondary leading-snug">
            {concept.key_facts.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}

      {related.length > 0 && (
        <div>
          <h5 className="text-sm text-text-muted font-medium uppercase tracking-[0.08em] mb-1.5">Related concepts</h5>
          <div className="flex flex-wrap gap-1.5">
            {related.slice(0, 12).map(r => (
              <button
                key={r.id}
                onClick={() => onSelect(r.id)}
                className="text-sm px-2 py-[2px] rounded border border-border-primary/40 text-text-secondary hover:border-accent/40 hover:text-accent transition-colors"
              >
                {r.canonical_name}
              </button>
            ))}
          </div>
        </div>
      )}

      {concept.sources.length > 0 && (
        <div>
          <h5 className="text-sm text-text-muted font-medium uppercase tracking-[0.08em] mb-1.5">Sources</h5>
          <ul className="space-y-1">
            {concept.sources.slice(0, 8).map((s, i) => (
              <li key={i}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline truncate block"
                  title={s.url}
                >
                  {s.title || domainFrom(s.url)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-1.5 pt-1 border-t border-border-primary/30">
        <Button size="sm" variant="ghost" disabled title="Merge with another concept (coming soon)">Merge&hellip;</Button>
        <Button size="sm" variant="ghost" disabled title="Rename concept (coming soon)">Rename</Button>
      </div>
    </div>
  );
}

function SessionConfigView({
  session, sessionId, onDelete,
}: {
  session: { id: string; config: Record<string, unknown> };
  sessionId: string;
  onDelete?: () => void;
}) {
  const updateConfig = useUpdateQueryConfig();
  const { data: defaults, isLoading } = useResearchDefaults();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading || !defaults) return <PageLoading />;

  const save = (path: string, value: unknown) => {
    updateConfig.mutate({ id: sessionId, config: patchByPath(path, value) });
  };

  const resetField = (path: string) => {
    const defaultValue = getByPath(defaults, path);
    updateConfig.mutate({ id: sessionId, config: patchByPath(path, defaultValue) });
  };

  return (
    <div className="space-y-6">
      <ConfigForm
        title="Session config"
        subtitle="Per-query overrides. The dot marks a value that differs from the defaults; changes apply to the next iteration."
        value={session.config}
        baseline={defaults as unknown as Record<string, unknown>}
        onSave={save}
        onResetField={resetField}
      />
      {onDelete && (
        <div className="border border-error/30 rounded p-4 bg-error/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-text-primary">Delete this query</div>
              <div className="text-sm text-text-muted mt-0.5">
                Removes the query, all threads, findings, and sources. This cannot be undone.
              </div>
            </div>
            {confirmDelete ? (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                <Button size="sm" variant="danger" onClick={onDelete}>Confirm delete</Button>
              </div>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>Delete query</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
// Session banner — surfaces role priming + wall-clock countdown +
// promote-to-long-lived button. Header adapts: "Live" when a wall-clock cap
// is set, otherwise just "Role" (so deep-mode queries with role priming on
// don't get a misleading Live label). Hidden when there's nothing to show.
// ---------------------------------------------------------------------------

function LiveModeBanner({ session }: { session: { id: string; status: string; created_at: string; config: Record<string, unknown> } }) {
  const promote = usePromoteResearchQuery();
  const schedule = (session.config.schedule ?? {}) as { max_session_duration_minutes?: number | null };
  const cap = schedule.max_session_duration_minutes;
  const roleLabel = (session.config.role_label as string | null | undefined) ?? null;
  const isPaused = session.status === 'paused';
  const isLive = cap != null;

  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isLive || isPaused) return;
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [isLive, isPaused]);

  if (!isLive && !roleLabel && !isPaused) return null;

  let countdownNode: React.ReactNode = null;
  if (isLive && !isPaused) {
    const elapsedMs = Date.now() - new Date(session.created_at).getTime();
    const remainMs = Math.max(0, cap! * 60_000 - elapsedMs);
    const remainMin = Math.floor(remainMs / 60_000);
    const remainSec = Math.floor((remainMs % 60_000) / 1000);
    countdownNode = (
      <span className="font-mono tabular-nums text-accent">
        {remainMin}:{remainSec.toString().padStart(2, '0')} left
      </span>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded border border-accent/30 bg-accent/5 px-3 py-2 mb-2 text-sm">
      <span className="font-medium text-accent">{isLive ? 'Live' : 'Role'}</span>
      {roleLabel && (
        <span className="text-text-muted">
          {isLive ? <>Role: <span className="text-text-primary">{roleLabel}</span></> : <span className="text-text-primary">{roleLabel}</span>}
        </span>
      )}
      {isLive && (
        <span className="text-text-muted">
          Cap: <span className="text-text-primary">{cap}m</span>
        </span>
      )}
      {countdownNode}
      {isPaused && (
        <>
          <span className="text-warning">Paused — best-effort report ready</span>
          <Button
            size="sm"
            onClick={() => promote.mutate(session.id)}
            loading={promote.isPending}
          >Promote to long-lived</Button>
        </>
      )}
    </div>
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
  const { data: postMortems = [] } = usePostMortems(id!);
  // listPostMortems returns DESC by created_at, so [0] is the latest snapshot.
  const latestPostMortem = postMortems[0];
  const updateQuery = useUpdateResearchQuery();
  const updateConfig = useUpdateQueryConfig();
  const runResearch = useRunResearch();
  const cancelJob = useCancelJob();
  const deleteQuery = useDeleteResearchQuery();

  type Tab = 'document' | 'graph' | 'sources' | 'activity' | 'config';
  const TAB_VALUES: readonly Tab[] = ['document','graph','sources','activity','config'];
  // Honour `#tab=telemetry` etc. so cross-page links can deep-link into a
  // specific tab. Listens for hashchange so in-page links that
  // only mutate the hash also take effect without a full remount.
  const tabFromHash = (): Tab | null => {
    if (typeof window === 'undefined') return null;
    const m = window.location.hash.match(/^#tab=([a-z]+)/);
    const candidate = m?.[1] as Tab | undefined;
    return candidate && TAB_VALUES.includes(candidate) ? candidate : null;
  };
  const [tab, setTab] = useState<Tab>(() => tabFromHash() ?? 'document');
  useEffect(() => {
    function onHashChange() {
      const next = tabFromHash();
      if (next) setTab(next);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [pendingConceptName, setPendingConceptName] = useState<string | null>(null);

  const navigateToConcept = useCallback((name: string) => {
    setPendingConceptName(name);
    setTab('graph');
  }, []);

  const findingCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of findingsData) map.set(f.thread_id, (map.get(f.thread_id) ?? 0) + 1);
    return map;
  }, [findingsData]);

  const scheduleCfg = (session?.config?.schedule) as Record<string, unknown> | undefined;

  const { data: conceptsData } = useConcepts(id ?? '');
  const conceptsCount = conceptsData?.length ?? 0;
  const { data: sourcesData } = useSources(id ?? '');
  const sourcesTotal = useMemo(() => {
    const c = sourcesData?.counts;
    if (!c) return 0;
    return (c.pending ?? 0) + (c.extracted ?? 0) + (c.failed ?? 0) + (c.skipped ?? 0);
  }, [sourcesData]);

  // Cross-navigation helpers
  const navigateToGraph = useCallback((threadId: string) => {
    setSelectedThreadId(threadId);
    setTab('graph');
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
  const selectedMode = activeJob?.mode ?? (scheduleCfg?.mode as string) ?? 'default';

  function cancelAll() { for (const j of activeJobs) cancelJob.mutate({ jobId: j.id }); }

  function setRunMode(mode: 'priority' | 'default' | 'scheduled') {
    updateConfig.mutate({ id: id!, config: { schedule: { ...(scheduleCfg as object), mode } } });
  }

  function handleToggleEnabled() {
    if (isEnabled) {
      updateQuery.mutate({ id: id!, status: 'paused' });
      cancelAll();
    } else {
      updateQuery.mutate({ id: id!, status: 'active' });
      if (selectedMode === 'priority') {
        const iterations = (session!.config as Record<string, unknown>).burst_iterations as number ?? 10;
        runResearch.mutate({ sessionId: id!, mode: 'priority', iterations });
      } else if (selectedMode === 'default') {
        runResearch.mutate({ sessionId: id!, mode: 'default' });
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
              <PageTitleLink to="/research">Research Sessions</PageTitleLink>
              <PageTitleSeparator />
              <PageTitle>{session.title}</PageTitle>
              {latestPostMortem && latestPostMortem.verdict === 'flag' && latestPostMortem.flags.length > 0 && (
                <FlagChip
                  flags={latestPostMortem.flags}
                  createdAt={latestPostMortem.created_at}
                  onClick={() => setTab('activity')}
                />
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-4">
              {/* Run mode controls */}
              <div className="flex items-center gap-1">
                {(['priority', 'default', 'scheduled'] as const).map(m => (
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
            <p className="text-sm text-text-muted line-clamp-3 mb-2">{session.prompt_short || session.prompt}</p>

            <div className="mb-2">
              <QuestionShapeBar session={session} />
            </div>

            <LiveModeBanner session={session} />

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
            {(() => {
              const busy = workers.filter(w => w.currentJob).length;
              if (busy === 0) return null;
              return (
                <span className="text-sm text-text-muted">
                  {busy} {busy === 1 ? 'worker' : 'workers'}
                </span>
              );
            })()}
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 mt-3 -mb-px relative z-10">
            {([
              { key: 'document' as const, label: 'Document', count: undefined },
              { key: 'graph' as const, label: 'Graph', count: conceptsCount + threadsData.length },
              { key: 'sources' as const, label: 'Sources', count: sourcesTotal },
              { key: 'activity' as const, label: 'Activity', count: undefined },
              { key: 'config' as const, label: 'Config', count: undefined },
            ]).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={clsx('px-3 py-2 text-sm font-medium border-b-2 transition-colors inline-flex items-center gap-1.5',
                  tab === t.key ? 'border-accent text-accent bg-bg-primary' : 'border-transparent text-text-muted hover:text-text-secondary')}>
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className={clsx(
                    'text-sm tabular-nums px-1.5 py-[1px] rounded',
                    tab === t.key ? 'bg-accent/10 text-accent' : 'bg-bg-tertiary text-text-muted',
                  )}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
          </div>{/* end secondary content */}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === 'document' && (
            <DocumentView
              findings={findingsData}
              threads={threadsData}
              onNavigateToConcept={navigateToConcept}
              document={session?.document || undefined}
              sessionId={id!}
              title={session?.title}
            />
          )}
          {tab === 'graph' && (
            <ResearchGraphView
              sessionId={id!}
              threads={threadsData}
              findings={findingsData}
              findingCounts={findingCounts}
              allSteps={allSteps}
              events={events}
              isRunning={isRunning}
              sessionFetchText={sessionFetchText}
              onToggleSessionFetch={handleToggleSessionFetch}
              activity={activity}
              jobs={jobs}
              selectedThreadId={selectedThreadId}
              onSelectThread={setSelectedThreadId}
              onNavigateToDocument={navigateToDocument}
              pendingConceptName={pendingConceptName}
              onConsumePendingConcept={() => setPendingConceptName(null)}
            />
          )}
          {tab === 'sources' && (
            <SourcesView sessionId={id!} onNavigateToTelemetry={() => setTab('activity')} />
          )}
          {tab === 'activity' && (
            <ResearchActivityView session={session} sessionId={id!} onNavigateToThread={navigateToGraph} />
          )}
          {tab === 'config' && (
            <SessionConfigView
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
