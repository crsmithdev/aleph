/**
 * ResearchGraphView — merged Knowledge + Process tab.
 *
 * Layout follows docs/mockups/research-graph.html (Variant E):
 *   - Left (320px): hierarchy tree — seed threads, child threads, concepts
 *   - Center (flex): canvas — switches between three lenses:
 *       * Concepts · graph  (the force-directed concept graph from KnowledgeView)
 *       * Threads · map     (the force-directed thread map from MapView)
 *       * Live · stream     (the timeline + findings panes from LiveView)
 *   - Right (360px, hidden below 1600px): inspector — reactive to selection,
 *     defaults to the seed thread's top findings so first paint is never blank.
 *
 * Information preservation: every element previously rendered by the Knowledge
 * tab (concept graph, filters, LOD slider, spotlight toggle, ConceptInspector,
 * ConceptList) and the Process tab (live timeline, thread tree, findings list,
 * thread map with depth filter) remains reachable from this view. The lens
 * toolbar exposes all three center-pane modes; the left tree exposes selection
 * for any thread or concept; the right inspector surfaces concept aliases /
 * facts / sources / related when a concept is focused.
 *
 * Default-state gate: on mount the canvas pre-selects (a) the concepts lens
 * when concepts exist, otherwise the threads lens; (b) the highest-finding-
 * count concept or the first seed thread. The tree auto-expands every seed
 * one level. Inspector populates from the default selection. No "click to
 * load" empty state is reachable on first paint.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  type ResearchThread, type ResearchFinding, type ResearchStep,
  type StreamEvent, type ResearchActivity, type ResearchJob,
  type ConceptWithStats, type ConceptLink,
  useConcepts, useConceptLinks, useConceptDetail,
} from '../../api/research-hooks';
import {
  KnowledgeView, MapView, LiveView,
  findSeedAncestor, domainFrom,
} from './ResearchQueryDetailPage';

type Lens = 'concepts' | 'threads' | 'live';

type Selection =
  | { kind: 'thread'; id: string }
  | { kind: 'concept'; id: string }
  | { kind: 'none' };

interface Props {
  sessionId: string;
  threads: ResearchThread[];
  findings: ResearchFinding[];
  findingCounts: Map<string, number>;
  allSteps: ResearchStep[];
  events: StreamEvent[];
  isRunning: boolean;
  sessionFetchText: boolean;
  onToggleSessionFetch: () => void;
  activity?: ResearchActivity;
  jobs?: ResearchJob[];
  selectedThreadId: string | null;
  onSelectThread: (id: string | null) => void;
  onNavigateToDocument: (threadId: string) => void;
  pendingConceptName: string | null;
  onConsumePendingConcept: () => void;
}

export function ResearchGraphView(props: Props) {
  const {
    sessionId, threads, findings, findingCounts, allSteps, events,
    isRunning, sessionFetchText, onToggleSessionFetch,
    selectedThreadId, onSelectThread,
    pendingConceptName, onConsumePendingConcept,
  } = props;

  const { data: concepts = [] } = useConcepts(sessionId);
  const { data: links = [] } = useConceptLinks(sessionId);

  // Default lens: concepts if any exist, otherwise threads (per default-state gate).
  const [lens, setLens] = useState<Lens>(() =>
    concepts.length > 0 ? 'concepts' : 'threads'
  );
  // Bump default once concepts arrive after first paint.
  useEffect(() => {
    if (lens === 'threads' && concepts.length > 0 && !userPickedLens.current) {
      setLens('concepts');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concepts.length]);
  const userPickedLens = React.useRef(false);
  const pickLens = (l: Lens) => { userPickedLens.current = true; setLens(l); };

  // Default selection: highest-finding-count concept (or first), else seed thread.
  const seedThreads = useMemo(() => threads.filter(t => t.depth === 0), [threads]);

  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  // Hydrate default selection once data is available.
  useEffect(() => {
    if (selection.kind !== 'none') return;
    if (concepts.length > 0) {
      const top = [...concepts].sort((a, b) => b.finding_count - a.finding_count)[0];
      if (top) setSelection({ kind: 'concept', id: top.id });
      return;
    }
    if (seedThreads.length > 0) {
      setSelection({ kind: 'thread', id: seedThreads[0].id });
    } else if (threads.length > 0) {
      setSelection({ kind: 'thread', id: threads[0].id });
    }
  }, [concepts, seedThreads, threads, selection.kind]);

  // Honour incoming selectedThreadId (from cross-tab navigation).
  useEffect(() => {
    if (selectedThreadId) setSelection({ kind: 'thread', id: selectedThreadId });
  }, [selectedThreadId]);

  // Honour incoming pendingConceptName (from Document → concept link).
  useEffect(() => {
    if (!pendingConceptName || concepts.length === 0) return;
    const slugify = (s: string) =>
      s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const target = slugify(pendingConceptName);
    const match =
      concepts.find(c => slugify(c.canonical_name) === target) ??
      concepts.find(c => c.aliases.some(a => slugify(a) === target));
    if (match) {
      setSelection({ kind: 'concept', id: match.id });
      pickLens('concepts');
    }
    onConsumePendingConcept();
  }, [pendingConceptName, concepts, onConsumePendingConcept]);

  const navigateToLive = (threadId: string) => {
    onSelectThread(threadId);
    setSelection({ kind: 'thread', id: threadId });
    pickLens('live');
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Lens toolbar — visible on all lenses */}
      <div className="flex items-center gap-3 mb-3 flex-wrap shrink-0">
        <div className="flex items-center gap-0.5 border border-border-primary/40 rounded p-0.5">
          {([
            { key: 'concepts' as const, label: 'Concepts · graph', count: concepts.length },
            { key: 'threads' as const, label: 'Threads · map', count: threads.length },
            { key: 'live' as const, label: 'Live · stream', count: findings.length },
          ]).map(o => (
            <button
              key={o.key}
              onClick={() => pickLens(o.key)}
              className={clsx(
                'px-2.5 py-[3px] text-xs uppercase tracking-[0.08em] rounded transition-colors inline-flex items-center gap-1.5',
                lens === o.key
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {o.label}
              {o.count > 0 && (
                <span className="font-mono text-[10px] tabular-nums opacity-70">{o.count}</span>
              )}
            </button>
          ))}
        </div>
        <div className="text-sm text-text-muted">
          {selection.kind === 'concept' && (
            <>selected <span className="font-mono text-accent">
              {concepts.find(c => c.id === selection.id)?.canonical_name ?? '—'}
            </span></>
          )}
          {selection.kind === 'thread' && (
            <>selected <span className="font-mono text-info">
              {threads.find(t => t.id === selection.id)?.short_query
                ?? threads.find(t => t.id === selection.id)?.query ?? '—'}
            </span></>
          )}
        </div>
      </div>

      {/* Three-pane workspace.
          - <1600px: hide right inspector; left tree stays.
          - When lens === 'live', LiveView already provides its own three-pane
            layout (threads | findings); we hand it the full center+right area
            and skip the redundant tree/inspector for that lens. */}
      {lens === 'live' ? (
        <div className="flex-1 min-h-0">
          <LiveView
            threads={threads}
            findings={findings}
            allSteps={allSteps}
            events={events}
            isRunning={isRunning}
            sessionId={sessionId}
            sessionFetchText={sessionFetchText}
            onToggleSessionFetch={onToggleSessionFetch}
          />
        </div>
      ) : (
        <div className="grid grid-cols-[320px_minmax(0,1fr)] [@media(min-width:1600px)]:grid-cols-[320px_minmax(0,1fr)_360px] gap-0 flex-1 min-h-0 border border-border-primary/40 rounded overflow-hidden">
          <HierarchyTree
            threads={threads}
            concepts={concepts}
            findingCounts={findingCounts}
            selection={selection}
            onSelectThread={(id) => { setSelection({ kind: 'thread', id }); onSelectThread(id); }}
            onSelectConcept={(id) => { setSelection({ kind: 'concept', id }); pickLens('concepts'); }}
          />

          <div className="min-w-0 min-h-0 flex flex-col bg-bg-primary border-l border-border-primary/40 overflow-hidden">
            {lens === 'concepts' ? (
              concepts.length > 0 ? (
                <KnowledgeView
                  sessionId={sessionId}
                  pendingConceptName={null}
                  onConsumePending={() => {}}
                />
              ) : (
                <div className="p-8 text-sm text-text-muted">
                  No concepts have been extracted yet. Switch to <button
                    className="text-accent underline-offset-2 hover:underline"
                    onClick={() => pickLens('threads')}
                  >Threads · map</button> or run a few iterations to build the
                  concept graph.
                </div>
              )
            ) : (
              threads.length > 0 ? (
                <div className="p-4 overflow-auto">
                  <MapView
                    threads={threads}
                    findingCounts={findingCounts}
                    onNavigateToLive={navigateToLive}
                  />
                </div>
              ) : (
                <div className="p-8 text-sm text-text-muted">
                  No threads yet — run the session to spawn threads.
                </div>
              )
            )}
          </div>

          <div className="hidden [@media(min-width:1600px)]:flex flex-col bg-bg-secondary border-l border-border-primary/40 min-w-0 overflow-hidden">
            <Inspector
              sessionId={sessionId}
              threads={threads}
              findings={findings}
              findingCounts={findingCounts}
              concepts={concepts}
              links={links}
              selection={selection}
              onSelect={(s) => setSelection(s)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left pane: hierarchy tree (seeds → threads → concept children)
// ---------------------------------------------------------------------------

const STATUS_BAR: Record<string, string> = {
  active: 'bg-success',
  running: 'bg-success',
  queued: 'bg-warning',
  pending: 'bg-warning',
  exhausted: 'bg-text-disabled/60',
  pruned: 'bg-error/60',
};

function HierarchyTree({
  threads, concepts, findingCounts, selection, onSelectThread, onSelectConcept,
}: {
  threads: ResearchThread[];
  concepts: ConceptWithStats[];
  findingCounts: Map<string, number>;
  selection: Selection;
  onSelectThread: (id: string) => void;
  onSelectConcept: (id: string) => void;
}) {
  const [filter, setFilter] = useState('');

  // Build seed → child-threads grouping. Concepts are session-wide (not
  // attached to a specific thread in the data model), so we list them under
  // their highest-finding seed by membership in evidence findings: we don't
  // have that mapping cheaply here, so we list concepts as a flat group at
  // the top of the tree under a "Concepts" header. This keeps the tree
  // honest about what the data actually says.
  const seedToChildren = useMemo(() => {
    const map = new Map<string, ResearchThread[]>();
    const byId = new Map(threads.map(t => [t.id, t]));
    for (const t of threads) {
      if (t.depth === 0) continue;
      // walk up to find seed
      let cur: ResearchThread | undefined = t;
      let safety = 32;
      while (cur && cur.depth > 0 && safety-- > 0) {
        const parentId: string | null = cur.parent_thread_id;
        const parentThread: ResearchThread | undefined = parentId ? byId.get(parentId) : undefined;
        if (!parentThread) break;
        cur = parentThread;
      }
      if (cur && cur.depth === 0) {
        const arr = map.get(cur.id) ?? [];
        arr.push(t);
        map.set(cur.id, arr);
      }
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.depth - b.depth || a.created_at.localeCompare(b.created_at));
    }
    return map;
  }, [threads]);

  const seeds = useMemo(() => threads.filter(t => t.depth === 0), [threads]);
  const sortedConcepts = useMemo(
    () => [...concepts].sort((a, b) => b.finding_count - a.finding_count),
    [concepts],
  );

  const fnorm = filter.trim().toLowerCase();
  const matches = (s: string) => !fnorm || s.toLowerCase().includes(fnorm);

  const visibleSeeds = seeds.filter(s =>
    matches(s.short_query ?? s.query) ||
    (seedToChildren.get(s.id) ?? []).some(c => matches(c.short_query ?? c.query))
  );
  const visibleConcepts = sortedConcepts.filter(c =>
    matches(c.canonical_name) || c.aliases.some(a => matches(a))
  );

  return (
    <div className="flex flex-col bg-bg-secondary min-w-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-primary/40 shrink-0">
        <span className="text-sm font-semibold text-text-primary">Hierarchy</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-mono text-info">
          <span className="px-1 py-px rounded bg-info/15 border border-info/30">{threads.length}</span>
          <span className="text-text-muted">th</span>
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-accent">
          <span className="px-1 py-px rounded bg-accent/15 border border-accent/30">{concepts.length}</span>
          <span className="text-text-muted">co</span>
        </span>
      </div>
      <div className="px-2 py-1.5 border-b border-border-primary/40 shrink-0">
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="filter…"
          className="w-full bg-bg-tertiary border border-border-primary/40 rounded px-2 py-1 text-sm text-text-secondary placeholder:text-text-disabled focus:outline-none focus:border-accent/50"
        />
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {/* Seeds and child threads */}
        {visibleSeeds.map(seed => {
          const children = seedToChildren.get(seed.id) ?? [];
          const visibleChildren = children.filter(c => matches(c.short_query ?? c.query));
          const isSelected = selection.kind === 'thread' && selection.id === seed.id;
          return (
            <div key={seed.id}>
              <TreeRow
                depth={0}
                label={seed.short_query ?? seed.query}
                count={findingCounts.get(seed.id) ?? 0}
                statusBar={STATUS_BAR[seed.status] ?? 'bg-text-disabled/60'}
                selected={isSelected}
                onClick={() => onSelectThread(seed.id)}
              />
              {visibleChildren.map(child => {
                const sel = selection.kind === 'thread' && selection.id === child.id;
                return (
                  <TreeRow
                    key={child.id}
                    depth={Math.min(child.depth, 3)}
                    label={child.short_query ?? child.query}
                    count={findingCounts.get(child.id) ?? 0}
                    statusBar={STATUS_BAR[child.status] ?? 'bg-text-disabled/60'}
                    selected={sel}
                    onClick={() => onSelectThread(child.id)}
                  />
                );
              })}
            </div>
          );
        })}

        {/* Concepts group */}
        {visibleConcepts.length > 0 && (
          <>
            <div className="px-3 pt-3 pb-1 text-[10px] font-mono uppercase tracking-[0.14em] text-text-muted">
              Concepts · {visibleConcepts.length}
            </div>
            {visibleConcepts.slice(0, 64).map(c => {
              const sel = selection.kind === 'concept' && selection.id === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => onSelectConcept(c.id)}
                  className={clsx(
                    'w-full text-left flex items-center gap-1.5 px-3 py-1 text-sm pl-7',
                    sel ? 'bg-bg-tertiary text-accent' : 'text-accent/80 italic hover:bg-bg-tertiary/60',
                  )}
                  title={c.canonical_name}
                >
                  <span className="opacity-70">◇</span>
                  <span className="truncate flex-1">{c.canonical_name}</span>
                  <span className="font-mono text-[10px] tabular-nums opacity-70">{c.finding_count}</span>
                </button>
              );
            })}
            {visibleConcepts.length > 64 && (
              <div className="px-3 py-1 text-[11px] font-mono text-text-muted">
                +{visibleConcepts.length - 64} more
              </div>
            )}
          </>
        )}

        {visibleSeeds.length === 0 && visibleConcepts.length === 0 && (
          <div className="p-3 text-sm text-text-muted">No matches.</div>
        )}
      </div>
    </div>
  );
}

function TreeRow({
  depth, label, count, statusBar, selected, onClick,
}: {
  depth: number;
  label: string;
  count: number;
  statusBar: string;
  selected: boolean;
  onClick: () => void;
}) {
  const padLeft = 12 + depth * 14;
  return (
    <button
      onClick={onClick}
      style={{ paddingLeft: `${padLeft}px` }}
      className={clsx(
        'w-full text-left flex items-center gap-1.5 pr-3 py-1 text-sm',
        selected ? 'bg-bg-tertiary text-text-primary' : 'text-text-secondary hover:bg-bg-tertiary/60',
      )}
      title={label}
    >
      <span className={clsx('w-[3px] h-3.5 rounded-sm shrink-0', statusBar)} />
      <span className="truncate flex-1">{label}</span>
      {count > 0 && (
        <span className="font-mono text-[10px] tabular-nums text-text-muted">{count}</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Right pane: inspector — reactive to selection
// ---------------------------------------------------------------------------

function Inspector({
  sessionId, threads, findings, findingCounts,
  concepts, links, selection, onSelect,
}: {
  sessionId: string;
  threads: ResearchThread[];
  findings: ResearchFinding[];
  findingCounts: Map<string, number>;
  concepts: ConceptWithStats[];
  links: ConceptLink[];
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  // Avoid unused parameter warning; sessionId reserved for future detail fetches.
  void sessionId; void findingCounts;
  if (selection.kind === 'concept') {
    return <ConceptInspectorPane
      sessionId={sessionId}
      conceptId={selection.id}
      concepts={concepts}
      links={links}
      threads={threads}
      onSelectConcept={(id) => onSelect({ kind: 'concept', id })}
      onSelectThread={(id) => onSelect({ kind: 'thread', id })}
    />;
  }
  if (selection.kind === 'thread') {
    const thread = threads.find(t => t.id === selection.id);
    if (!thread) return <div className="p-4 text-sm text-text-muted">Thread not found.</div>;
    const threadFindings = findings.filter(f => f.thread_id === thread.id);
    return <ThreadInspectorPane thread={thread} findings={threadFindings} />;
  }
  return <div className="p-4 text-sm text-text-muted">Select a thread or concept.</div>;
}

function ConceptInspectorPane({
  sessionId, conceptId, concepts, links, threads, onSelectConcept, onSelectThread,
}: {
  sessionId: string;
  conceptId: string;
  concepts: ConceptWithStats[];
  links: ConceptLink[];
  threads: ResearchThread[];
  onSelectConcept: (id: string) => void;
  onSelectThread: (id: string) => void;
}) {
  const { data: detail } = useConceptDetail(sessionId, conceptId);
  const concept = concepts.find(c => c.id === conceptId);

  const related = useMemo(() => {
    const byId = new Map(concepts.map(c => [c.id, c]));
    const neighbours: Array<{ concept: ConceptWithStats; relation: string; direction: 'out' | 'in' }> = [];
    for (const l of links) {
      if (l.from_concept_id === conceptId) {
        const c = byId.get(l.to_concept_id);
        if (c) neighbours.push({ concept: c, relation: l.relation, direction: 'out' });
      } else if (l.to_concept_id === conceptId) {
        const c = byId.get(l.from_concept_id);
        if (c) neighbours.push({ concept: c, relation: l.relation, direction: 'in' });
      }
    }
    return neighbours;
  }, [links, concepts, conceptId]);

  if (!concept) return <div className="p-4 text-sm text-text-muted">Concept not found.</div>;

  // Source threads — best-effort: any thread that has at least one finding
  // whose id is in detail.finding_ids.
  const sourceThreads = useMemo(() => {
    if (!detail) return [] as ResearchThread[];
    const findingIds = new Set(detail.finding_ids);
    void findingIds; // we don't have findings → thread mapping here directly
    // Without a direct mapping we surface the top related threads by name match
    // — we do not invent data; instead leave this empty and let "linked
    // concepts" + the central graph carry the relationship.
    return [] as ResearchThread[];
  }, [detail]);
  void sourceThreads; void threads; void onSelectThread;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b border-border-primary/40 shrink-0">
        <h4 className="font-semibold text-text-primary text-base truncate" title={concept.canonical_name}>
          ◇ {concept.canonical_name}
        </h4>
        <div className="text-sm text-text-muted mt-1">
          {concept.finding_count} findings · {concept.source_count} sources
        </div>
        {concept.aliases.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {concept.aliases.slice(0, 6).map(a => (
              <span key={a} className="font-mono text-[10px] px-1.5 py-px rounded bg-bg-tertiary border border-border-primary/40 text-text-secondary">
                {a}
              </span>
            ))}
          </div>
        )}
      </div>

      {related.length > 0 && (
        <div className="px-4 py-3 border-b border-border-primary/40 shrink-0">
          <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-text-muted mb-2">
            Linked concepts ({related.length})
          </div>
          <div className="flex flex-col gap-1">
            {related.slice(0, 12).map(r => (
              <button
                key={r.concept.id + r.direction + r.relation}
                onClick={() => onSelectConcept(r.concept.id)}
                className="flex items-center gap-2 text-sm text-text-secondary hover:text-accent text-left"
              >
                <span className="font-mono text-[10px] px-1.5 py-px rounded bg-accent/10 border border-accent/30 text-accent shrink-0 truncate max-w-[120px]">
                  {r.concept.canonical_name}
                </span>
                <span className="italic text-text-muted text-xs truncate">
                  {r.direction === 'out' ? r.relation : `← ${r.relation}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
        {concept.summary && (
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-text-muted mb-1">Summary</div>
            <p className="text-sm leading-snug text-text-secondary">{concept.summary}</p>
          </div>
        )}
        {concept.key_facts.length > 0 && (
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-text-muted mb-1">Key facts</div>
            <ul className="list-disc pl-4 space-y-1 text-sm text-text-secondary">
              {concept.key_facts.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          </div>
        )}
        {detail?.sources && detail.sources.length > 0 && (
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-text-muted mb-1">
              Sources ({detail.sources.length})
            </div>
            <ul className="space-y-1">
              {detail.sources.slice(0, 8).map((s, i) => (
                <li key={i} className="text-sm">
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
        {!concept.summary && concept.key_facts.length === 0 && (!detail?.sources || detail.sources.length === 0) && (
          <p className="text-sm text-text-muted italic">
            No detail extracted yet for this concept.
          </p>
        )}
      </div>
    </div>
  );
}

function ThreadInspectorPane({
  thread, findings,
}: {
  thread: ResearchThread;
  findings: ResearchFinding[];
}) {
  const sorted = useMemo(
    () => [...findings].sort((a, b) => b.confidence - a.confidence),
    [findings],
  );
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b border-border-primary/40 shrink-0">
        <h4 className="font-semibold text-text-primary text-base">
          {thread.short_query ?? thread.query}
        </h4>
        <div className="text-sm text-text-muted mt-1 flex flex-wrap gap-2 font-mono">
          <span>depth {thread.depth}</span>
          <span>·</span>
          <span>{thread.status}</span>
          <span>·</span>
          <span>{thread.origin.replace(/_/g, ' ')}</span>
          <span>·</span>
          <span>p:{thread.priority.toFixed(2)}</span>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
        <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-text-muted">
          Findings ({sorted.length})
        </div>
        {sorted.length === 0 ? (
          <p className="text-sm text-text-muted italic">No findings on this thread yet.</p>
        ) : sorted.slice(0, 12).map(f => (
          <div key={f.id} className="border-t border-border-primary/30 pt-2 first:border-t-0 first:pt-0">
            <div className="text-sm text-text-primary leading-snug">{f.summary || f.content.slice(0, 240)}</div>
            <div className="mt-1.5 flex items-center gap-2 text-[11px] font-mono text-text-muted">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-7 h-1 rounded-sm bg-bg-tertiary overflow-hidden">
                  <span
                    className="block h-full bg-success"
                    style={{ width: `${Math.round(f.confidence * 100)}%` }}
                  />
                </span>
                <span className="tabular-nums">{f.confidence.toFixed(2)}</span>
              </span>
              {f.tags.slice(0, 2).map(t => (
                <span key={t} className="px-1 py-px rounded bg-bg-tertiary border border-border-primary/40 text-text-secondary truncate max-w-[100px]">{t}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Re-export for callers that imported these from the page module before.
export { findSeedAncestor };
