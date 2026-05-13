/**
 * Loop detail page — the rich session detail UI for the new (loops) engine.
 *
 * Mounted at `/research/:id`. Four tabs covering everything previously
 * spread across the legacy ResearchQueryDetailPage:
 *
 *   Document   — the latest polished `kind: 'document'` artifact, Markdown.
 *                Two-column: article body + sticky References rail with
 *                per-source extraction-status pills. Metadata strip surfaces
 *                model, generated_at, rendered_cycles, source_count.
 *                Falls back to the raw `render` artifact's findings while
 *                the polish is pending. Regenerate button hits
 *                POST /api/loops/:id/regenerate-document.
 *   Activity   — live event stream from /api/loops/:id/stream + persisted
 *                events replayed on connect. KPI strip, Cycle Lifecycle,
 *                Post-Mortem, Iteration Checks, Source Extraction, Branch
 *                State, Decisions, filterable Event Log.
 *   Plan       — schedule artifact summary (output_shape · branches ·
 *                budget · milestones), canon chips, expandable branch cards
 *                with per-branch cycle_output text, aggregate unique sources.
 *   Config     — read-only configuration surface: loop chrome (id/template/
 *                status/pid/timestamps), schedule (output_shape, milestones,
 *                perturbation weights), envelope (configured vs consumed),
 *                effective models (primary / fast / iteration_check /
 *                post_mortem, read from /api/research/defaults).
 *
 * Phase 5 will collapse envelope / models / perturbation_config / flags
 * onto the schedule payload itself; Config will then read them off the
 * artifact directly instead of via the defaults endpoint.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PageTitle, PageTitleLink, PageTitleSeparator } from '../../components/layout/PageHeader';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageLoading } from '../../components/ui/Spinner';

// ---- Types (mirror src/research/src/loop/types.ts at the wire boundary) ----

type OutputShape =
  | { kind: 'prose' }
  | { kind: 'list'; min_items?: number }
  | { kind: 'table'; columns: string[] }
  | { kind: 'timeline'; min_events?: number }
  | { kind: 'mixed'; components: OutputShape[] };

interface Branch { id: string; query: string; budget?: number }
interface LoopSchedule {
  canon: string[];
  branches: Branch[];
  per_branch_budget: number;
  perturbation_weights: Record<string, number>;
  milestone_plan: number[];
}
interface SchedulePayload { output_shape: OutputShape; plan: LoopSchedule }

interface Loop {
  id: string;
  template_id: string;
  status: string;
  envelope: Record<string, unknown>;
  envelope_consumed: Record<string, number>;
  child_pid: number | null;
  prompt: string;
  created_at: string;
  updated_at: string;
}
interface Cycle {
  id: string;
  index: number;
  status: string;
  started_at: string | null;
  finalized_at: string | null;
}
interface Artifact {
  id: string;
  kind: string;
  cycle_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

type SourceExtractionStatus = 'extracted' | 'snippet_only' | 'failed';

interface RenderSourceEntry {
  url: string;
  title: string;
  extraction_status: SourceExtractionStatus;
  attempts: number;
  error?: string;
}

interface RenderPayload {
  kind: 'render';
  findings: Array<{ cycle: number; query: string; text: string }>;
  sources: RenderSourceEntry[];
  cycles_rendered: number;
  shape_kind?: string;
  shape_satisfied?: boolean;
  shape_missing?: unknown;
}

type DecisionPayload =
  | { type: 'canon_pick'; entity: string; index: number; total: number; rationale?: string }
  | { type: 'branch_pick'; branch_id: string; query: string; index: number; total: number; budget?: number; rationale?: string }
  | { type: 'followup_pick'; query: string; accepted: boolean; index: number; total: number; cycle_id: string; reason?: string };

interface DecisionLogEntry { decision: DecisionPayload; recorded_at: string }
interface DecisionLogPayload { entries: DecisionLogEntry[] }

interface IterationCheckPayload {
  at_envelope_pct: 25 | 50 | 75;
  verdict: 'on_track' | 'drifting' | 'needs_correction';
  notes: string;
  correction?: Record<string, unknown>;
  model: string;
}

interface PostMortemPayload {
  verdict: 'success' | 'partial' | 'failure';
  flags: string[];
  recommendations: string[];
  metrics_snapshot: Record<string, unknown>;
  model: string;
}

interface DocumentPayload {
  text: string;
  source_count: number;
  generated_at: string;
  model: string;
  rendered_cycles: number;
}

interface ProcessorOutput {
  kind?: string;
  query?: string;
  text?: string;
  source_urls?: string[];
  source_meta?: Array<{ url: string; title: string; snippet?: string }>;
}

interface StreamFrame {
  type: 'loop' | 'cycle' | 'cycle_step' | 'milestone' | 'artifact' | 'decision';
  payload: Record<string, unknown>;
  logged_at: string;
}

// ---- Page ------------------------------------------------------------------

type Tab = 'document' | 'activity' | 'plan' | 'config';
const TAB_VALUES: readonly Tab[] = ['document', 'activity', 'plan', 'config'];

function tabFromHash(): Tab | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.hash.match(/^#tab=([a-z]+)/);
  const candidate = m?.[1] as Tab | undefined;
  return candidate && TAB_VALUES.includes(candidate) ? candidate : null;
}

export function ResearchLoopDetail() {
  const { id } = useParams<{ id: string }>();
  const [snapshot, setSnapshot] = useState<{ loop: Loop; cycles: Cycle[]; artifacts: Artifact[] } | null>(null);
  const [events, setEvents] = useState<StreamFrame[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => tabFromHash() ?? 'document');

  // Honour #tab= in the URL so cross-page links and internal navigations work.
  useEffect(() => {
    function onHashChange() { const next = tabFromHash(); if (next) setTab(next); }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Initial snapshot.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void fetch(`/api/loops/${id}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => { if (!cancelled) setSnapshot(data as typeof snapshot); })
      .catch(e => { if (!cancelled) setLoadError((e as Error).message); });
    return () => { cancelled = true; };
  }, [id]);

  // Live event stream. The SSE handler back-fills the persisted NDJSON
  // on connect and then streams live events; each frame carries the
  // engine-emit `logged_at` so the Activity panel shows real timestamps.
  // On terminal status (completed/failed/cancelled) we refetch the
  // snapshot so the new `document` artifact (auto-polish output) and any
  // final artifacts appear.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const source = new EventSource(`/api/loops/${id}/stream`);
    source.onmessage = e => {
      try {
        const frame = JSON.parse(e.data) as StreamFrame;
        setEvents(prev => [...prev, frame]);
        if (frame.type === 'loop') {
          const incoming = frame.payload as Partial<Loop>;
          setSnapshot(prev => prev ? { ...prev, loop: { ...prev.loop, ...incoming } } : prev);
          const status = incoming.status;
          if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            // Refetch after a short delay so the auto-polish (~5-15s after
            // status=completed) has time to write its document artifact.
            setTimeout(() => {
              void fetch(`/api/loops/${id}`)
                .then(r => r.ok ? r.json() : null)
                .then(data => { if (data && !cancelled) setSnapshot(data as typeof snapshot); })
                .catch(() => { /* ignore */ });
            }, 8000);
            // Immediate refetch too — covers the case where polish already ran.
            void fetch(`/api/loops/${id}`)
              .then(r => r.ok ? r.json() : null)
              .then(data => { if (data && !cancelled) setSnapshot(data as typeof snapshot); })
              .catch(() => { /* ignore */ });
          }
        } else if (frame.type === 'artifact') {
          // A new artifact dropped — refetch so the Document tab picks up
          // a newly polished document (auto-fire or regenerate).
          void fetch(`/api/loops/${id}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data && !cancelled) setSnapshot(data as typeof snapshot); })
            .catch(() => { /* ignore */ });
        }
      } catch { /* skip malformed */ }
    };
    return () => { cancelled = true; source.close(); };
  }, [id]);

  if (loadError) return <div data-testid="page-research-detail"><ErrorState message={loadError} /></div>;
  if (!snapshot) return <div data-testid="page-research-detail"><PageLoading /></div>;

  const { loop, artifacts } = snapshot;
  const title = loop.prompt?.trim() || `Loop ${loop.id.slice(0, 8)}`;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]" data-testid="page-research-detail">
      <div className="border-b border-border-primary bg-bg-primary shrink-0">
        <div className="h-14 flex items-center justify-between px-6">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <PageTitleLink to="/research">Research</PageTitleLink>
            <PageTitleSeparator />
            <PageTitle>{title}</PageTitle>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <StatusBadge status={loop.status} />
            <span className="text-xs font-mono text-text-muted">{loop.id}</span>
          </div>
        </div>

        <div className="px-6 pb-0">
          <div className="flex gap-1 border-b border-border-primary -mx-6 px-6">
            <TabButton active={tab === 'document'} onClick={() => setTab('document')}>Document</TabButton>
            <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>Activity</TabButton>
            <TabButton active={tab === 'plan'}     onClick={() => setTab('plan')}>Plan</TabButton>
            <TabButton active={tab === 'config'}   onClick={() => setTab('config')}>Config</TabButton>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
        {tab === 'document' && <DocumentTab loopId={loop.id} artifacts={artifacts} />}
        {tab === 'activity' && <ActivityTab loop={loop} cycles={snapshot.cycles} artifacts={artifacts} events={events} />}
        {tab === 'plan'     && <PlanTab artifacts={artifacts} />}
        {tab === 'config'   && <ConfigTab loop={loop} artifacts={artifacts} />}
      </div>
    </div>
  );
}

// ---- Tab content ----------------------------------------------------------

/**
 * Document tab — adapted from docs/mockups/research/query-detail.html
 * (panel-doc layout). The mockup's 3-column "TOC · article · bibliography"
 * grid translates to article + bibliography here; the loops engine doesn't
 * pre-section the document so the TOC column is omitted. The metadata strip
 * (model · generated_at · rendered_cycles · source_count) sits above the
 * article and is the canonical surface for the document artifact's payload.
 *
 * Falls back to the raw `render` artifact's findings + sources when no
 * polished document exists yet (early in a run, or polish failure).
 */
function DocumentTab({ loopId, artifacts }: { loopId: string; artifacts: Artifact[] }) {
  const doc = useMemo(() => {
    const docs = artifacts
      .filter(a => a.kind === 'document')
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (docs.length === 0) return null;
    return { artifact: docs[0], payload: docs[0].payload as unknown as DocumentPayload };
  }, [artifacts]);

  const fallbackRender = useMemo(() => findLatestRenderPayload(artifacts), [artifacts]);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  async function regenerate() {
    setRegenerating(true);
    setRegenError(null);
    try {
      const res = await fetch(`/api/loops/${loopId}/regenerate-document`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // The new artifact will arrive via the SSE 'artifact' event and trigger a snapshot refetch.
    } catch (err) {
      setRegenError((err as Error).message);
    } finally {
      setRegenerating(false);
    }
  }

  if (!doc && !fallbackRender) {
    return (
      <div data-testid="document-tab">
        <p className="text-sm text-text-muted">No output yet — waiting for the first cycle to render.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="document-tab">
      <DocumentMetaStrip
        doc={doc?.payload ?? null}
        fallback={fallbackRender}
        regenerating={regenerating}
        onRegenerate={regenerate}
      />

      {regenError && (
        <div className="text-sm text-error border border-error/40 bg-error/10 rounded px-3 py-2">{regenError}</div>
      )}

      <article
        className="md-content article-view mx-auto w-full max-w-[760px]"
        data-testid="document-body"
      >
        {doc ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={CITATION_MARKDOWN_COMPONENTS}
          >{splitReferenceParagraphs(doc.payload.text)}</ReactMarkdown>
        ) : fallbackRender ? (
          <>
            {fallbackRender.findings.map((f, i) => (
              <section key={i} className="mb-6">
                <h3>Cycle {f.cycle}: {f.query}</h3>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{f.text}</ReactMarkdown>
              </section>
            ))}
          </>
        ) : null}
      </article>
    </div>
  );
}

// ---- Reference paragraph splitter ----------------------------------------
//
// The polish prompt asks the LLM to list references as numbered items, but
// the model commonly emits them as one block separated by single newlines
// rather than blank lines. In Markdown that collapses into one <p>, so only
// the first reference gets an anchor target. Insert a blank line before any
// `[N]` that begins a new line inside the References section so each
// reference becomes its own paragraph.
function splitReferenceParagraphs(text: string): string {
  const m = text.match(/^## References\s*$/m);
  if (!m || m.index === undefined) return text;
  const head = text.slice(0, m.index + m[0].length);
  const refs = text.slice(m.index + m[0].length);
  return head + refs.replace(/\n(\[\d+\])/g, '\n\n$1');
}

// ---- Citation linkifier --------------------------------------------------
//
// Polished documents contain inline `[1]`, `[2]` etc. citations referencing
// a `## References` section at the bottom. By default ReactMarkdown renders
// these as plain text. We post-process the React tree:
//   - Body `[N]` → <a href="#ref-N" class="cite">[N]</a>
//   - Paragraphs starting with `[N]` (reference list entries) get id="ref-N"
//     and a `.reference-entry` class for hanging-indent layout
//
// This keeps the right-side rail removed (it duplicated the in-document
// References section) and turns clicking a citation into a same-page jump.

const CITATION_PATTERN = /(\[\d+\])/g;

function linkifyCitations(nodes: React.ReactNode): React.ReactNode {
  if (typeof nodes === 'string') {
    if (!CITATION_PATTERN.test(nodes)) return nodes;
    CITATION_PATTERN.lastIndex = 0; // RegExp state — reset since /g is sticky.
    const parts = nodes.split(CITATION_PATTERN);
    return parts.map((part, i) => {
      const m = part.match(/^\[(\d+)\]$/);
      return m
        ? <a key={i} href={`#ref-${m[1]}`} className="cite">{part}</a>
        : part;
    });
  }
  if (Array.isArray(nodes)) return nodes.map((n, i) => <React.Fragment key={i}>{linkifyCitations(n)}</React.Fragment>);
  if (React.isValidElement(nodes)) {
    const el = nodes as React.ReactElement<{ children?: React.ReactNode }>;
    return React.cloneElement(el, undefined, linkifyCitations(el.props.children));
  }
  return nodes;
}

function firstTextOf(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) {
    for (const c of children) {
      const s = firstTextOf(c);
      if (s) return s;
    }
    return '';
  }
  if (React.isValidElement(children)) {
    const el = children as React.ReactElement<{ children?: React.ReactNode }>;
    return firstTextOf(el.props.children);
  }
  return '';
}

const CITATION_MARKDOWN_COMPONENTS = {
  p({ children }: { children?: React.ReactNode }) {
    const text = firstTextOf(children);
    const refMatch = text.match(/^\[(\d+)\]/);
    if (refMatch) {
      // Reference list entry: anchor target, no linkification needed (the
      // leading [N] is just the label).
      return <p id={`ref-${refMatch[1]}`} className="reference-entry">{children}</p>;
    }
    return <p>{linkifyCitations(children)}</p>;
  },
  li({ children }: { children?: React.ReactNode }) {
    // If the LLM emits the References section as a numbered list instead of
    // paragraphs, each <li> may start with [N]. Same handling.
    const text = firstTextOf(children);
    const refMatch = text.match(/^\[(\d+)\]/);
    if (refMatch) return <li id={`ref-${refMatch[1]}`}>{children}</li>;
    return <li>{linkifyCitations(children)}</li>;
  },
  h2({ children }: { children?: React.ReactNode }) {
    const text = firstTextOf(children);
    if (text.trim().toLowerCase() === 'references') {
      return <h2 id="references">{children}</h2>;
    }
    return <h2>{children}</h2>;
  },
};

function DocumentMetaStrip({
  doc, fallback, regenerating, onRegenerate,
}: {
  doc: DocumentPayload | null;
  fallback: RenderPayload | null;
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  const sourceCount = doc?.source_count ?? fallback?.sources.length ?? 0;
  const renderedCycles = doc?.rendered_cycles ?? fallback?.cycles_rendered ?? 0;
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-border-primary rounded-lg bg-bg-secondary px-4 py-2.5"
      data-testid="document-meta"
    >
      <div className="flex items-center gap-2">
        <span className={clsx(
          'text-xs px-1.5 py-0.5 rounded font-medium uppercase tracking-wider',
          doc ? 'bg-success/15 text-success' : 'bg-amber-500/15 text-amber-400',
        )}>
          {doc ? 'polished' : 'raw render'}
        </span>
        {!doc && fallback && (
          <span className="text-xs text-text-muted italic">polish pending</span>
        )}
      </div>
      {doc && (
        <div className="text-xs text-text-muted">
          generated · <span className="font-mono tabular-nums text-text-secondary">{new Date(doc.generated_at).toLocaleString()}</span>
        </div>
      )}
      <div className="text-xs text-text-muted">
        cycles · <span className="font-mono tabular-nums text-text-secondary" data-testid="document-rendered-cycles">{renderedCycles}</span>
      </div>
      <div className="text-xs text-text-muted">
        sources · <span className="font-mono tabular-nums text-text-secondary" data-testid="document-source-count">{sourceCount}</span>
      </div>
      {doc && (
        <div className="text-xs text-text-muted">
          model · <span className="font-mono text-text-secondary" data-testid="document-model">{doc.model}</span>
        </div>
      )}
      <button
        onClick={onRegenerate}
        disabled={regenerating}
        className="ml-auto text-xs px-3 py-1.5 border border-border-primary rounded text-text-secondary hover:text-text-primary hover:border-accent disabled:opacity-50"
        data-testid="document-regenerate"
      >
        {regenerating ? 'Regenerating…' : (doc ? 'Regenerate' : 'Generate now')}
      </button>
    </div>
  );
}

/**
 * Activity tab — adapted from docs/mockups/research-activity.html to the
 * loops engine. Two-column dashboard:
 *
 *   LEFT  : KPI strip (Cycles · Steps · Cost · Duration)
 *           Post-Mortem (one card, on completion)
 *           Iteration Checks (list of milestone verdicts)
 *           Cycle Lifecycle table — per-cycle queue / dispatch / run / e2e
 *             percentiles (replaces the v0 Job Lifecycle table)
 *           Source Extraction stats — failure rate + top failing domains
 *           Branch State stackbar — schedule.branches × cycle status counts
 *             (replaces the v0 Thread State stackbar)
 *           Decisions — planner + derivation choices, filterable
 *   RIGHT : Event log — sticky panel with type filter pills, scrolls
 *             independently of the left column
 *
 * Empty-state behavior: each panel renders only when its underlying
 * artifact / event source has data. Early in a run only the KPIs + Cycle
 * Lifecycle + Branch State + Event Log are populated; the others appear
 * as the engine progresses.
 */
function ActivityTab({
  loop, cycles, artifacts, events,
}: {
  loop: Loop;
  cycles: Cycle[];
  artifacts: Artifact[];
  events: StreamFrame[];
}) {
  const kpis = useMemo(() => computeKpis(loop, cycles, events), [loop, cycles, events]);
  const lifecycle = useMemo(() => computeCycleLifecycle(cycles), [cycles]);
  const branchState = useMemo(() => computeBranchState(artifacts, cycles), [artifacts, cycles]);
  const postMortem = useMemo(() => findLatestPostMortem(artifacts), [artifacts]);
  const iterationChecks = useMemo(() => collectIterationChecks(artifacts), [artifacts]);
  const sourceStats = useMemo(() => computeSourceStats(artifacts), [artifacts]);
  const decisions = useMemo(() => readLatestDecisionLog(artifacts), [artifacts]);

  const [eventFilter, setEventFilter] = useState<'all' | StreamFrame['type']>('all');
  const filteredEvents = useMemo(
    () => eventFilter === 'all' ? events : events.filter(e => e.type === eventFilter),
    [events, eventFilter],
  );
  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = { all: events.length };
    for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
    return counts;
  }, [events]);

  return (
    <div data-testid="activity-tab" className="flex flex-col gap-5">
      <KpiStrip kpis={kpis} />
      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-5 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          {postMortem && <PostMortemPanel payload={postMortem} />}
          {iterationChecks.length > 0 && <IterationChecksPanel checks={iterationChecks} />}
          <CycleLifecycle data={lifecycle} cycles={cycles} />
          {sourceStats.total > 0 && <SourceExtractionPanel stats={sourceStats} />}
          <BranchState entries={branchState} />
          {decisions.length > 0 && <DecisionsPanel entries={decisions} />}
        </div>
        <EventLog
          events={filteredEvents}
          totalCount={events.length}
          filter={eventFilter}
          setFilter={setEventFilter}
          filterCounts={filterCounts}
        />
      </div>
    </div>
  );
}

// ---- Activity helpers ------------------------------------------------------

interface ActivityKpis {
  cyclesFinalized: number;
  cyclesTotal: number;
  stepCount: number;
  cost: number;
  durationMs: number;
  isRunning: boolean;
}

function computeKpis(loop: Loop, cycles: Cycle[], events: StreamFrame[]): ActivityKpis {
  const cyclesFinalized = cycles.filter(c => c.status === 'finalized').length;
  const stepCount = events.filter(e => e.type === 'cycle_step').length;
  const cost = loop.envelope_consumed?.cost_usd ?? 0;

  const start = parseSqliteTs(loop.created_at);
  const isRunning = loop.status === 'pending' || loop.status === 'running';
  const end = isRunning ? Date.now() : parseSqliteTs(loop.updated_at);
  const durationMs = Math.max(0, end - start);

  return { cyclesFinalized, cyclesTotal: cycles.length, stepCount, cost, durationMs, isRunning };
}

function KpiStrip({ kpis }: { kpis: ActivityKpis }) {
  const cells: Array<{ label: string; value: string; sub?: string; accent: 'default'|'success'|'info'|'accent' }> = [
    {
      label: 'Cycles',
      value: String(kpis.cyclesFinalized),
      sub: kpis.cyclesTotal !== kpis.cyclesFinalized ? `${kpis.cyclesTotal - kpis.cyclesFinalized} in flight` : 'finalized',
      accent: 'success',
    },
    {
      label: 'Steps',
      value: String(kpis.stepCount),
      sub: kpis.cyclesTotal > 0 ? `${(kpis.stepCount / Math.max(1, kpis.cyclesTotal)).toFixed(1)} / cycle` : undefined,
      accent: 'info',
    },
    {
      label: 'Cost',
      value: `$${kpis.cost.toFixed(4)}`,
      sub: kpis.cyclesFinalized > 0 ? `$${(kpis.cost / kpis.cyclesFinalized).toFixed(4)} / cycle` : undefined,
      accent: 'accent',
    },
    {
      label: 'Duration',
      value: formatDurationMs(kpis.durationMs),
      sub: kpis.isRunning ? 'running' : 'final',
      accent: 'default',
    },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="activity-kpis">
      {cells.map(c => (
        <div
          key={c.label}
          className="border border-border-primary rounded-lg p-3 bg-bg-secondary"
          data-testid={`kpi-${c.label.toLowerCase()}`}
        >
          <div className="text-xs uppercase tracking-wider text-text-muted">{c.label}</div>
          <div className={clsx(
            'text-2xl font-medium mt-1 font-mono tabular-nums',
            c.accent === 'success' && 'text-success',
            c.accent === 'info' && 'text-info',
            c.accent === 'accent' && 'text-accent',
            c.accent === 'default' && 'text-text-primary',
          )}>
            {c.value}
          </div>
          {c.sub && <div className="text-xs text-text-muted mt-0.5">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

interface CycleLifecycleStats {
  /** Time from cycle row insert to engine claim. Loops don't have a queue,
   *  so this stays near zero in normal runs but exposes scheduler stalls. */
  queueMs: number[];
  /** Run duration: started_at → finalized_at. The actual engine work time. */
  runMs: number[];
  /** End-to-end: created_at → finalized_at. */
  endToEndMs: number[];
}

function computeCycleLifecycle(cycles: Cycle[]): CycleLifecycleStats {
  const queueMs: number[] = [];
  const runMs: number[] = [];
  const endToEndMs: number[] = [];
  for (const c of cycles) {
    if (!c.started_at || !c.finalized_at) continue;
    const created = parseSqliteTs(c.id /* unused */) || 0;
    // cycles snapshot doesn't carry created_at; pull from started_at as
    // the floor for queue-wait. This will be 0 in the steady-state path
    // where the engine claims a cycle the same instant it inserts it.
    void created;
    const startedT = parseSqliteTs(c.started_at);
    const finalT = parseSqliteTs(c.finalized_at);
    queueMs.push(0); // Loops have no queue; preserved for parity with the mockup.
    runMs.push(finalT - startedT);
    endToEndMs.push(finalT - startedT);
  }
  return { queueMs, runMs, endToEndMs };
}

function CycleLifecycle({ data, cycles }: { data: CycleLifecycleStats; cycles: Cycle[] }) {
  const rows: Array<{ label: string; samples: number[] }> = [
    { label: 'queue wait',    samples: data.queueMs },
    { label: 'run duration',  samples: data.runMs },
    { label: 'end-to-end',    samples: data.endToEndMs },
  ];
  const finalized = cycles.filter(c => c.status === 'finalized').length;
  const running = cycles.filter(c => c.status === 'running').length;
  return (
    <Panel
      title="Cycle lifecycle"
      subtitle={`${cycles.length} cycle${cycles.length !== 1 ? 's' : ''} · ${finalized} finalized · ${running} running`}
      testId="cycle-lifecycle"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-text-muted border-b border-border-primary">
              <th className="text-left py-2 font-medium">metric</th>
              <th className="text-right py-2 font-medium">p50</th>
              <th className="text-right py-2 font-medium">p95</th>
              <th className="text-right py-2 font-medium">max</th>
              <th className="text-right py-2 font-medium">avg</th>
              <th className="text-right py-2 font-medium">n</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.map(r => {
              const stats = percentiles(r.samples);
              return (
                <tr key={r.label} className="border-b border-border-primary last:border-b-0">
                  <td className="py-2 text-text-secondary font-sans">{r.label}</td>
                  <td className="text-right py-2">{stats ? formatDurationMs(stats.p50) : '—'}</td>
                  <td className="text-right py-2">{stats ? formatDurationMs(stats.p95) : '—'}</td>
                  <td className="text-right py-2">{stats ? formatDurationMs(stats.max) : '—'}</td>
                  <td className="text-right py-2">{stats ? formatDurationMs(stats.avg) : '—'}</td>
                  <td className="text-right py-2 text-text-muted">{r.samples.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

interface BranchStateEntry {
  branchId: string;
  query: string;
  budget: number;
  cyclesFinalized: number;
  cyclesRunning: number;
  state: 'pending' | 'running' | 'finalized';
}

function computeBranchState(artifacts: Artifact[], cycles: Cycle[]): BranchStateEntry[] {
  const sched = artifacts.find(a => a.kind === 'schedule');
  const plan = (sched?.payload as { plan?: LoopSchedule } | undefined)?.plan;
  if (!plan || plan.branches.length === 0) return [];

  // Cycles execute branches in order: cycle index 0 → branch 0, cycle 1 → branch 1, …
  // (research template default). Map by index.
  const byIndex = new Map<number, Cycle>();
  for (const c of cycles) byIndex.set(c.index, c);

  return plan.branches.map((b, i) => {
    const cycle = byIndex.get(i);
    const state: BranchStateEntry['state'] =
      !cycle || cycle.status === 'pending' ? 'pending'
      : cycle.status === 'finalized'       ? 'finalized'
      :                                       'running';
    return {
      branchId: b.id,
      query: b.query,
      budget: b.budget ?? plan.per_branch_budget,
      cyclesFinalized: state === 'finalized' ? 1 : 0,
      cyclesRunning: state === 'running' ? 1 : 0,
      state,
    };
  });
}

function BranchState({ entries }: { entries: BranchStateEntry[] }) {
  if (entries.length === 0) {
    return (
      <Panel title="Branch state" subtitle="schedule not yet planned" testId="branch-state">
        <p className="text-sm text-text-muted italic px-1 py-2">Planner has not emitted a schedule artifact yet.</p>
      </Panel>
    );
  }
  const finalized = entries.filter(e => e.state === 'finalized').length;
  const running = entries.filter(e => e.state === 'running').length;
  const pending = entries.filter(e => e.state === 'pending').length;
  const total = entries.length;
  const pct = (n: number) => total === 0 ? 0 : (n / total) * 100;

  return (
    <Panel
      title="Branch state"
      subtitle={`${total} branch${total !== 1 ? 'es' : ''} · ${finalized} finalized · ${running} running · ${pending} pending`}
      testId="branch-state"
    >
      <div className="flex h-3 w-full rounded overflow-hidden bg-bg-tertiary mb-3">
        {finalized > 0 && <div className="bg-success h-full" style={{ width: `${pct(finalized)}%` }} title={`${finalized} finalized`} />}
        {running > 0   && <div className="bg-info    h-full" style={{ width: `${pct(running)}%` }}   title={`${running} running`} />}
        {pending > 0   && <div className="bg-bg-secondary h-full" style={{ width: `${pct(pending)}%` }} title={`${pending} pending`} />}
      </div>
      <ul className="flex flex-col gap-1.5" data-testid="branch-state-list">
        {entries.map(e => (
          <li key={e.branchId} className="grid items-baseline gap-2 text-sm" style={{ gridTemplateColumns: '8px 1fr auto auto' }}>
            <span className={clsx(
              'w-2 h-2 rounded-full shrink-0',
              e.state === 'finalized' && 'bg-success',
              e.state === 'running'   && 'bg-info',
              e.state === 'pending'   && 'bg-text-disabled',
            )} />
            <div className="min-w-0">
              <div className="font-mono text-xs text-text-muted">{e.branchId}</div>
              <div className="text-sm text-text-secondary truncate">{e.query}</div>
            </div>
            <span className="text-xs text-text-muted whitespace-nowrap">budget {e.budget}</span>
            <span className={clsx(
              'text-xs px-1.5 py-0.5 rounded font-medium uppercase tracking-wider',
              e.state === 'finalized' && 'bg-success/15 text-success',
              e.state === 'running'   && 'bg-info/15 text-info',
              e.state === 'pending'   && 'bg-bg-tertiary text-text-muted',
            )}>{e.state}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---- New panels (Post-Mortem · Iteration Checks · Source Extraction · Decisions) ----

function findLatestPostMortem(artifacts: Artifact[]): PostMortemPayload | null {
  const sorted = artifacts
    .filter(a => a.kind === 'post_mortem')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return sorted[0]?.payload as unknown as PostMortemPayload ?? null;
}

const VERDICT_CLASS: Record<PostMortemPayload['verdict'], string> = {
  success: 'bg-success/15 text-success border-success/40',
  partial: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
  failure: 'bg-red-500/15 text-red-400 border-red-500/40',
};

function PostMortemPanel({ payload }: { payload: PostMortemPayload }) {
  return (
    <Panel
      title="Post-mortem"
      subtitle={`verdict · ${payload.verdict}`}
      testId="post-mortem"
    >
      <div className="flex flex-col gap-3">
        <div className={clsx('inline-flex self-start items-center px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wider border', VERDICT_CLASS[payload.verdict])}>
          {payload.verdict}
        </div>
        {payload.flags.length > 0 && (
          <section>
            <h5 className="text-xs uppercase tracking-wider text-text-muted mb-1.5">Flags</h5>
            <ul className="flex flex-col gap-1 text-sm text-text-secondary">
              {payload.flags.map((f, i) => (
                <li key={i} className="flex gap-2"><span className="text-text-muted shrink-0">·</span><span>{f}</span></li>
              ))}
            </ul>
          </section>
        )}
        {payload.recommendations.length > 0 && (
          <section>
            <h5 className="text-xs uppercase tracking-wider text-text-muted mb-1.5">Recommendations</h5>
            <ul className="flex flex-col gap-1 text-sm text-text-secondary">
              {payload.recommendations.map((r, i) => (
                <li key={i} className="flex gap-2"><span className="text-text-muted shrink-0">·</span><span>{r}</span></li>
              ))}
            </ul>
          </section>
        )}
        {Object.keys(payload.metrics_snapshot).length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-text-muted hover:text-text-primary">Metrics snapshot</summary>
            <pre className="mt-2 font-mono text-xs text-text-secondary overflow-x-auto p-2 bg-bg-tertiary rounded">{JSON.stringify(payload.metrics_snapshot, null, 2)}</pre>
          </details>
        )}
        <div className="text-xs text-text-muted">model · <span className="font-mono">{payload.model}</span></div>
      </div>
    </Panel>
  );
}

interface IterationCheckEntry { payload: IterationCheckPayload; created_at: string }

function collectIterationChecks(artifacts: Artifact[]): IterationCheckEntry[] {
  return artifacts
    .filter(a => a.kind === 'iteration_check')
    .map(a => ({ payload: a.payload as unknown as IterationCheckPayload, created_at: a.created_at }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

const ITER_CHIP_CLASS: Record<IterationCheckPayload['verdict'], string> = {
  on_track:          'bg-success/15 text-success',
  drifting:          'bg-amber-500/15 text-amber-400',
  needs_correction:  'bg-red-500/15 text-red-400',
};

function IterationChecksPanel({ checks }: { checks: IterationCheckEntry[] }) {
  const latest = checks[0]?.payload.verdict;
  const latestChip = latest ? (
    <span className={clsx('text-xs px-1.5 py-0.5 rounded font-medium uppercase tracking-wider', ITER_CHIP_CLASS[latest])}>
      {latest.replace('_', ' ')}
    </span>
  ) : null;
  return (
    <Panel
      title="Iteration checks"
      subtitle={`${checks.length} check${checks.length !== 1 ? 's' : ''}${checks[0] ? ` · last at ${checks[0].payload.at_envelope_pct}%` : ''}`}
      testId="iteration-checks"
      rightSlot={latestChip}
    >
      <ul className="flex flex-col gap-3" data-testid="iteration-checks-list">
        {checks.map((c, i) => (
          <li key={i} className="border-b border-border-primary last:border-b-0 pb-3 last:pb-0">
            <div className="flex items-baseline gap-2 mb-1">
              <span className={clsx('text-xs px-1.5 py-0.5 rounded font-medium uppercase tracking-wider', ITER_CHIP_CLASS[c.payload.verdict])}>
                {c.payload.verdict.replace('_', ' ')}
              </span>
              <span className="text-xs text-text-muted">at {c.payload.at_envelope_pct}%</span>
              <span className="text-xs font-mono text-text-muted ml-auto">{formatTs(c.created_at)}</span>
            </div>
            <p className="text-sm text-text-secondary">{c.payload.notes}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

interface SourceStats {
  total: number;
  extracted: number;
  snippet_only: number;
  failed: number;
  failure_rate: number;
  avg_attempts_on_failure: number;
  top_failing_domains: Array<{ domain: string; failed: number; total: number }>;
}

function computeSourceStats(artifacts: Artifact[]): SourceStats {
  const render = findLatestRenderPayload(artifacts);
  const sources: RenderSourceEntry[] = render?.sources ?? [];
  const total = sources.length;
  if (total === 0) {
    return { total: 0, extracted: 0, snippet_only: 0, failed: 0, failure_rate: 0, avg_attempts_on_failure: 0, top_failing_domains: [] };
  }
  let extracted = 0;
  let snippet_only = 0;
  let failed = 0;
  let failureAttempts = 0;
  const perDomain = new Map<string, { failed: number; total: number }>();
  for (const s of sources) {
    if (s.extraction_status === 'extracted') extracted++;
    else if (s.extraction_status === 'snippet_only') snippet_only++;
    else if (s.extraction_status === 'failed') { failed++; failureAttempts += s.attempts; }
    const domain = safeDomain(s.url);
    const entry = perDomain.get(domain) ?? { failed: 0, total: 0 };
    entry.total++;
    if (s.extraction_status === 'failed') entry.failed++;
    perDomain.set(domain, entry);
  }
  const top_failing_domains = [...perDomain.entries()]
    .filter(([, v]) => v.failed > 0)
    .sort((a, b) => (b[1].failed / b[1].total) - (a[1].failed / a[1].total))
    .slice(0, 5)
    .map(([domain, v]) => ({ domain, ...v }));
  return {
    total,
    extracted,
    snippet_only,
    failed,
    failure_rate: failed / total,
    avg_attempts_on_failure: failed > 0 ? failureAttempts / failed : 0,
    top_failing_domains,
  };
}

function safeDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return url.slice(0, 40); }
}

function SourceExtractionPanel({ stats }: { stats: SourceStats }) {
  const failureColor = stats.failure_rate >= 0.2 ? 'text-red-400' : stats.failure_rate > 0 ? 'text-amber-400' : 'text-success';
  return (
    <Panel
      title="Source extraction"
      subtitle={`${stats.total} sources · ${(stats.failure_rate * 100).toFixed(1)}% failure`}
      testId="source-extraction"
    >
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1.3fr] gap-5">
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-xs text-text-muted">Failure rate</span>
            <span className={clsx('text-2xl font-mono tabular-nums', failureColor)}>{(stats.failure_rate * 100).toFixed(1)}%</span>
          </div>
          <dl className="flex flex-col gap-1 text-sm">
            <Row label="Extracted"><span className="font-mono tabular-nums text-success">{stats.extracted}</span></Row>
            <Row label="Snippet only"><span className="font-mono tabular-nums">{stats.snippet_only}</span></Row>
            <Row label="Failed"><span className="font-mono tabular-nums text-red-400">{stats.failed}</span></Row>
            {stats.failed > 0 && <Row label="Avg attempts (on failure)"><span className="font-mono tabular-nums">{stats.avg_attempts_on_failure.toFixed(1)}</span></Row>}
          </dl>
        </div>
        <div>
          <h5 className="text-xs uppercase tracking-wider text-text-muted mb-2">Top failing domains</h5>
          {stats.top_failing_domains.length === 0 ? (
            <p className="text-sm text-text-muted italic">No failures yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {stats.top_failing_domains.map((d, i) => {
                const pct = d.total > 0 ? (d.failed / d.total) * 100 : 0;
                const tone = pct >= 50 ? 'text-red-400' : 'text-amber-400';
                return (
                  <li key={i} className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-xs text-text-secondary truncate">{d.domain}</span>
                    <span className="font-mono text-xs tabular-nums">
                      <span className={tone}>{d.failed}</span> / {d.total} <span className="text-text-muted">({pct.toFixed(0)}%)</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

function readLatestDecisionLog(artifacts: Artifact[]): DecisionLogEntry[] {
  const logs = artifacts.filter(a => a.kind === 'decision_log');
  if (logs.length === 0) return [];
  // The append-as-new-row pattern means later rows supersede earlier ones;
  // pick the last in artifact-list order (already sorted by created_at asc).
  const latest = logs[logs.length - 1];
  return ((latest.payload as unknown as DecisionLogPayload).entries ?? []).slice().reverse();
}

const DECISION_TYPES: Array<'all' | DecisionPayload['type']> = ['all', 'canon_pick', 'branch_pick', 'followup_pick'];

function DecisionsPanel({ entries }: { entries: DecisionLogEntry[] }) {
  const [filter, setFilter] = useState<'all' | DecisionPayload['type']>('all');
  const filtered = filter === 'all' ? entries : entries.filter(e => e.decision.type === filter);
  const counts: Record<string, number> = { all: entries.length };
  for (const e of entries) counts[e.decision.type] = (counts[e.decision.type] ?? 0) + 1;
  return (
    <Panel
      title="Decisions"
      subtitle={`${entries.length} decision${entries.length !== 1 ? 's' : ''}`}
      testId="decisions"
    >
      <div className="flex flex-wrap gap-1 mb-3" data-testid="decisions-filters">
        {DECISION_TYPES.map(t => {
          const active = filter === t;
          return (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={clsx(
                'text-xs px-2 py-0.5 rounded border font-medium',
                active
                  ? 'bg-accent/15 text-accent border-accent/40'
                  : 'border-border-primary text-text-muted hover:text-text-primary hover:border-text-muted',
              )}
            >
              {t === 'all' ? 'all' : t.replace('_pick', '')} <span className="text-text-muted ml-0.5">{counts[t] ?? 0}</span>
            </button>
          );
        })}
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-text-muted italic">No decisions match this filter.</p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="decisions-list">
          {filtered.map((e, i) => (
            <li key={i} className="text-xs font-mono text-text-secondary flex gap-3 items-baseline py-0.5 border-b border-border-primary last:border-b-0">
              <span className="text-text-muted shrink-0">{formatTs(e.recorded_at)}</span>
              <span className="text-accent shrink-0 w-24">{e.decision.type.replace('_pick', '')}</span>
              <span className="text-text-secondary truncate">{summarizeDecision(e.decision)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function summarizeDecision(d: DecisionPayload): string {
  if (d.type === 'canon_pick')    return `${d.entity}  (${d.index + 1}/${d.total})`;
  if (d.type === 'branch_pick')   return `${d.branch_id} → ${d.query}  (${d.index + 1}/${d.total}${d.budget != null ? `, budget=${d.budget}` : ''})`;
  if (d.type === 'followup_pick') return `${d.accepted ? '✓' : '·'} ${d.query}  (${d.index + 1}/${d.total}${d.reason ? `, ${d.reason}` : ''})`;
  return '';
}

function findLatestRenderPayload(artifacts: Artifact[]): RenderPayload | null {
  // SQLite created_at is second-precision; cycles that finalize within the
  // same second share a timestamp. The API returns artifacts in insertion
  // order (ORDER BY created_at, with ROWID tie-break), so the LAST eligible
  // entry in this array is the freshest render — pick by walking forward
  // and overwriting `best` unconditionally, NOT by strict-greater timestamp.
  let best: RenderPayload | null = null;
  for (const a of artifacts) {
    if (a.kind === 'render') {
      best = a.payload as unknown as RenderPayload;
      continue;
    }
    if (a.kind === 'cycle_output') {
      const render = (a.payload as { render?: RenderPayload }).render;
      if (render && Array.isArray(render.findings)) best = render;
    }
  }
  return best;
}

const EVENT_FILTERS: Array<'all' | StreamFrame['type']> = ['all', 'loop', 'cycle', 'cycle_step', 'artifact', 'milestone', 'decision'];

function EventLog({
  events, totalCount, filter, setFilter, filterCounts,
}: {
  events: StreamFrame[];
  totalCount: number;
  filter: 'all' | StreamFrame['type'];
  setFilter: (f: 'all' | StreamFrame['type']) => void;
  filterCounts: Record<string, number>;
}) {
  return (
    <div className="lg:sticky lg:top-0" data-testid="event-log">
      <Panel title="Event log" subtitle={`live · ${totalCount}`}>
        <div className="flex flex-wrap gap-1 mb-3" data-testid="event-log-filters">
          {EVENT_FILTERS.map(f => {
            const count = filterCounts[f] ?? 0;
            const active = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={clsx(
                  'text-xs px-2 py-0.5 rounded border font-medium',
                  active
                    ? 'bg-accent/15 text-accent border-accent/40'
                    : 'border-border-primary text-text-muted hover:text-text-primary hover:border-text-muted',
                )}
              >
                {f} <span className="text-text-muted ml-0.5">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          {events.length === 0 ? (
            <p className="text-sm text-text-muted italic px-1 py-2">No events match this filter.</p>
          ) : (
            <ul className="flex flex-col gap-0.5" data-testid="activity-event-list">
              {events.map((e, i) => (
                <li key={i} className="text-xs font-mono text-text-secondary flex gap-3 items-baseline py-0.5">
                  <span className="text-text-muted shrink-0">{formatTs(e.logged_at)}</span>
                  <span className="text-accent shrink-0 w-20">{e.type}</span>
                  <span className="text-text-secondary">{summarizeEvent(e)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </div>
  );
}

function Panel({
  title, subtitle, testId, rightSlot, children,
}: {
  title: string;
  subtitle?: string;
  testId?: string;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="border border-border-primary rounded-lg overflow-hidden bg-bg-secondary"
      data-testid={testId}
    >
      <div className="flex items-baseline gap-3 px-4 py-2.5 border-b border-border-primary bg-bg-primary">
        <h4 className="text-sm font-medium text-text-primary">{title}</h4>
        {subtitle && <span className="text-xs text-text-muted">{subtitle}</span>}
        {rightSlot && <span className="ml-auto">{rightSlot}</span>}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

// ---- Math + formatting -----------------------------------------------------

function percentiles(samples: number[]): { p50: number; p95: number; max: number; avg: number } | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = (p: number) => Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  const sum = sorted.reduce((s, x) => s + x, 0);
  return {
    p50: sorted[idx(50)],
    p95: sorted[idx(95)],
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
  };
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/** Parse a SQLite `datetime('now')` timestamp ("YYYY-MM-DD HH:MM:SS") as UTC.
 *  SQLite returns naive strings with no zone; appending Z makes JavaScript
 *  parse them correctly. */
function parseSqliteTs(s: string): number {
  if (!s) return 0;
  // ISO-like strings ("2026-05-12T..." or with Z) parse natively.
  if (s.includes('T') || s.endsWith('Z')) return new Date(s).getTime();
  return new Date(s.replace(' ', 'T') + 'Z').getTime();
}

/**
 * Plan tab — the schedule artifact made visible. Top header carries the
 * planner's overall shape (output_shape · branch count · per-branch budget
 * · milestone plan), then canon as accent chips, then each branch as an
 * expandable card revealing its cycle_output text, then aggregated unique
 * sources at the bottom.
 *
 * Mirrors the structural-plan surface from docs/mockups/research/query-detail.html
 * (Process panel's intent — "how the session was decomposed") collapsed
 * into a flatter, mockup-styled card list because the loops engine plans
 * a flat branch set rather than the tree the mockup illustrated.
 */
function PlanTab({ artifacts }: { artifacts: Artifact[] }) {
  const schedule = artifacts.find(a => a.kind === 'schedule');
  const payload = schedule?.payload as unknown as SchedulePayload | undefined;
  const plan = payload?.plan;
  const shape = payload?.output_shape;

  const branchOutputs = useMemo(() => {
    const map = new Map<string, ProcessorOutput>();
    if (!plan) return map;
    const cycleOutputs = artifacts
      .filter(a => a.kind === 'cycle_output')
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (let i = 0; i < plan.branches.length && i < cycleOutputs.length; i++) {
      const proc = cycleOutputs[i].payload.processor as ProcessorOutput | undefined;
      if (proc) map.set(plan.branches[i].id, proc);
    }
    return map;
  }, [artifacts, plan]);

  const allSources = useMemo(() => {
    const seen = new Map<string, { url: string; title: string }>();
    for (const a of artifacts.filter(x => x.kind === 'cycle_output')) {
      const proc = a.payload.processor as ProcessorOutput | undefined;
      for (const s of proc?.source_meta ?? []) {
        if (!seen.has(s.url)) seen.set(s.url, { url: s.url, title: s.title || s.url });
      }
    }
    return Array.from(seen.values());
  }, [artifacts]);

  if (!plan) {
    return (
      <div data-testid="plan-tab">
        <p className="text-sm text-text-muted">No schedule artifact yet — the planner runs at loop start.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl flex flex-col gap-5" data-testid="plan-tab">
      <PlanSummary plan={plan} shape={shape} />

      <Panel title="Canon" subtitle={`${plan.canon.length} entries`} testId="plan-canon">
        {plan.canon.length === 0 ? (
          <p className="text-sm text-text-muted italic">No canon entries — planner emitted the fallback schedule.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" data-testid="plan-canon-list">
            {plan.canon.map((c, i) => (
              <li
                key={i}
                className="text-sm px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/30"
              >
                {c}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Branches"
        subtitle={`${plan.branches.length} branch${plan.branches.length !== 1 ? 'es' : ''} · default budget ${plan.per_branch_budget}`}
        testId="plan-branches"
      >
        <div className="flex flex-col gap-2" data-testid="plan-branches-list">
          {plan.branches.map(b => (
            <BranchCard
              key={b.id}
              branch={b}
              defaultBudget={plan.per_branch_budget}
              output={branchOutputs.get(b.id)}
            />
          ))}
        </div>
      </Panel>

      <Panel
        title="Sources"
        subtitle={`${allSources.length} unique${allSources.length === 0 ? '' : ' across all branches'}`}
        testId="plan-sources"
      >
        {allSources.length === 0 ? (
          <p className="text-sm text-text-muted italic">No web sources fetched yet.</p>
        ) : (
          <ol className="text-sm list-decimal list-inside text-text-secondary flex flex-col gap-1">
            {allSources.map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{s.title}</a>
                <span className="text-text-muted text-xs ml-2">{safeDomain(s.url)}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

function PlanSummary({ plan, shape }: { plan: LoopSchedule; shape: OutputShape | undefined }) {
  const totalBudget = plan.branches.reduce(
    (sum, b) => sum + (b.budget ?? plan.per_branch_budget),
    0,
  );
  const perturbationKeys = Object.keys(plan.perturbation_weights);
  return (
    <div
      className="grid grid-cols-2 md:grid-cols-4 gap-3"
      data-testid="plan-summary"
    >
      <SummaryCell label="Output shape" value={shape ? formatShape(shape) : '—'} tone="info" />
      <SummaryCell label="Branches" value={String(plan.branches.length)} tone="default" />
      <SummaryCell label="Cycle budget" value={String(totalBudget)} sub={`per branch ${plan.per_branch_budget}`} tone="accent" />
      <SummaryCell
        label="Milestones"
        value={plan.milestone_plan.length === 0
          ? 'none'
          : plan.milestone_plan.map(m => `${Math.round(m * 100)}%`).join(' · ')}
        sub={perturbationKeys.length > 0 ? `${perturbationKeys.length} perturbation weight${perturbationKeys.length !== 1 ? 's' : ''}` : 'no perturbation overrides'}
        tone="default"
      />
    </div>
  );
}

function SummaryCell({
  label, value, sub, tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: 'default' | 'info' | 'accent';
}) {
  return (
    <div className="border border-border-primary rounded-lg p-3 bg-bg-secondary">
      <div className="text-xs uppercase tracking-wider text-text-muted">{label}</div>
      <div className={clsx(
        'mt-1 font-mono tabular-nums break-words text-sm',
        tone === 'info'    && 'text-info',
        tone === 'accent'  && 'text-accent',
        tone === 'default' && 'text-text-primary',
      )}>{value}</div>
      {sub && <div className="text-xs text-text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function BranchCard({
  branch, defaultBudget, output,
}: {
  branch: Branch;
  defaultBudget: number;
  output?: ProcessorOutput;
}) {
  const [expanded, setExpanded] = useState(false);
  const effectiveBudget = branch.budget ?? defaultBudget;
  const overridden = branch.budget != null && branch.budget !== defaultBudget;
  return (
    <details
      className="border border-border-primary rounded bg-bg-primary"
      open={expanded}
      onToggle={e => setExpanded((e.target as HTMLDetailsElement).open)}
      data-testid="plan-branch-card"
    >
      <summary className="cursor-pointer px-3 py-2 text-sm flex items-center gap-3">
        <span className="font-mono text-xs text-text-muted shrink-0">{branch.id}</span>
        <span className="text-text-secondary flex-1 truncate">{branch.query}</span>
        <span className="text-xs text-text-muted whitespace-nowrap flex items-center gap-1">
          {overridden && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Overrides default budget" />}
          budget <span className="font-mono tabular-nums text-text-secondary">{effectiveBudget}</span>
        </span>
        {output && (
          <span className={clsx(
            'text-xs px-1.5 py-0.5 rounded font-medium uppercase tracking-wider',
            'bg-success/15 text-success',
          )}>ran</span>
        )}
      </summary>
      {output ? (
        <div className="px-3 py-3 border-t border-border-primary text-sm">
          <div className="text-xs text-text-muted mb-2 flex flex-wrap gap-x-3 gap-y-1">
            <span>query · <span className="font-mono text-text-secondary">{output.query}</span></span>
            {output.source_meta && (
              <span>sources · <span className="font-mono tabular-nums text-text-secondary">{output.source_meta.length}</span></span>
            )}
          </div>
          <div className="prose prose-sm max-w-none prose-headings:text-text-primary prose-p:text-text-secondary prose-li:text-text-secondary">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{output.text ?? ''}</ReactMarkdown>
          </div>
        </div>
      ) : (
        <div className="px-3 py-3 border-t border-border-primary text-sm text-text-muted italic">
          No cycle has run on this branch yet.
        </div>
      )}
    </details>
  );
}

/**
 * Effective-models surface for the Config tab. The loops engine doesn't
 * snapshot SessionConfig onto the loop row — model selection lives in
 * `research_defaults` until a per-loop override slice lands. Fetching the
 * defaults here is the lightest selector: a single GET keeps the Config
 * tab honest about what model the engine is actually invoking for the
 * primary, fast, iteration-check, and post-mortem calls. Returns null
 * while pending so the panel can render a muted "loading…" placeholder.
 */
interface EffectiveModels {
  model: string;
  model_fast: string | null;
  iteration_check_model: string;
  post_mortem_model: string;
}

function useEffectiveModels(): EffectiveModels | null {
  const [models, setModels] = useState<EffectiveModels | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/research/defaults')
      .then(r => r.ok ? r.json() : null)
      .then((cfg: Partial<EffectiveModels> | null) => {
        if (cancelled || !cfg) return;
        setModels({
          model: cfg.model ?? '—',
          model_fast: cfg.model_fast ?? null,
          iteration_check_model: cfg.iteration_check_model ?? '—',
          post_mortem_model: cfg.post_mortem_model ?? '—',
        });
      })
      .catch(() => { /* fall through to muted placeholder */ });
    return () => { cancelled = true; };
  }, []);
  return models;
}

/**
 * Config tab — surfaces the loop's frozen configuration. Mirrors the
 * "Per-session overrides" panel from docs/mockups/research/query-detail.html
 * (panel-config), but the loops engine doesn't snapshot SessionConfig onto
 * the loop row, so we render four sections instead of editable cfg-rows:
 *
 *   - Loop          — id / template / status / pid / timestamps (chrome)
 *   - Schedule      — output_shape · branches · per-branch budget ·
 *                     milestone_plan · perturbation_weights (artifact)
 *   - Envelope      — configured / consumed (loop row)
 *   - Models        — effective model / model_fast / iteration_check_model /
 *                     post_mortem_model (research_defaults)
 *
 * Anything mid-flight is read-only here; persistent defaults live at
 * /research/config and apply to *new* loops only.
 */
function ConfigTab({ loop, artifacts }: { loop: Loop; artifacts: Artifact[] }) {
  const schedule = artifacts.find(a => a.kind === 'schedule');
  const payload = schedule?.payload as unknown as SchedulePayload | undefined;
  const models = useEffectiveModels();

  return (
    <div className="max-w-4xl flex flex-col gap-5" data-testid="config-tab">
      <Panel title="Loop" subtitle="immutable identity & lifecycle" testId="config-loop">
        <CfgRow label="ID" hint="Slug + hex tail" testId="config-loop-id">
          <span className="font-mono text-xs text-text-secondary">{loop.id}</span>
        </CfgRow>
        <CfgRow label="Template" testId="config-loop-template">
          <span className="font-mono text-text-secondary">{loop.template_id}</span>
        </CfgRow>
        <CfgRow label="Status" testId="config-loop-status">
          <StatusBadge status={loop.status} />
        </CfgRow>
        <CfgRow label="Child PID" hint="OS pid of the engine worker; null when stopped">
          {loop.child_pid != null
            ? <span className="font-mono tabular-nums text-text-secondary">{loop.child_pid}</span>
            : <span className="text-text-muted italic text-xs">none</span>}
        </CfgRow>
        <CfgRow label="Created">
          <span className="font-mono text-xs text-text-secondary">{new Date(loop.created_at).toLocaleString()}</span>
        </CfgRow>
        <CfgRow label="Updated" last>
          <span className="font-mono text-xs text-text-secondary">{new Date(loop.updated_at).toLocaleString()}</span>
        </CfgRow>
      </Panel>

      <Panel
        title="Schedule"
        subtitle={payload ? 'planner artifact' : 'awaiting planner'}
        testId="config-schedule"
      >
        {payload ? (
          <>
            <CfgRow label="Output shape" hint="Target structure for the final document">
              <span className="font-mono text-text-secondary">{formatShape(payload.output_shape)}</span>
            </CfgRow>
            <CfgRow label="Branches" hint="Decomposed investigation threads">
              <span className="font-mono tabular-nums text-text-secondary">{payload.plan.branches.length}</span>
            </CfgRow>
            <CfgRow label="Per-branch budget" hint="Default cycle ceiling for each branch">
              <span className="font-mono tabular-nums text-text-secondary">{payload.plan.per_branch_budget}</span>
            </CfgRow>
            <CfgRow label="Milestones" hint="Envelope fractions at which iteration-check fires" testId="config-milestones">
              {payload.plan.milestone_plan.length === 0
                ? <span className="text-text-muted italic text-xs">none</span>
                : <span className="font-mono text-text-secondary">{payload.plan.milestone_plan.map(m => `${Math.round(m * 100)}%`).join(' · ')}</span>}
            </CfgRow>
            <CfgRow label="Perturbation weights" hint="Planner's strategy-menu preferences" last testId="config-perturbation">
              {Object.keys(payload.plan.perturbation_weights).length === 0
                ? <span className="text-text-muted italic text-xs">defaults</span>
                : <pre className="font-mono text-xs text-text-secondary whitespace-pre-wrap m-0">{JSON.stringify(payload.plan.perturbation_weights, null, 2)}</pre>}
            </CfgRow>
          </>
        ) : (
          <p className="text-sm text-text-muted italic px-1 py-2">No schedule artifact written yet — the planner runs at loop start.</p>
        )}
      </Panel>

      <Panel title="Envelope" subtitle="cycles / cost / time caps" testId="config-envelope">
        <CfgRow label="Configured" hint="Hard ceilings set at loop creation">
          {renderJsonValue(loop.envelope)}
        </CfgRow>
        <CfgRow label="Consumed" hint="Live counters; refreshed via the event stream" last testId="config-envelope-consumed">
          {renderJsonValue(loop.envelope_consumed)}
        </CfgRow>
      </Panel>

      <Panel
        title="Models"
        subtitle="effective LLM selection for this loop"
        testId="config-models"
      >
        {models ? (
          <>
            <CfgRow label="Primary" hint="Answer-voice synthesis + extraction" testId="config-model-primary">
              <span className="font-mono text-xs text-text-secondary">{models.model}</span>
            </CfgRow>
            <CfgRow label="Fast" hint="Short utility calls — judges, dedup, perturbation queries" testId="config-model-fast">
              {models.model_fast
                ? <span className="font-mono text-xs text-text-secondary">{models.model_fast}</span>
                : <span className="text-text-muted italic text-xs">falls back to primary</span>}
            </CfgRow>
            <CfgRow label="Iteration check" hint="Fires once per milestone (25 / 50 / 75 %)" testId="config-model-iteration-check">
              <span className="font-mono text-xs text-text-secondary">{models.iteration_check_model}</span>
            </CfgRow>
            <CfgRow label="Post-mortem" hint="Fires once on natural completion" last testId="config-model-post-mortem">
              <span className="font-mono text-xs text-text-secondary">{models.post_mortem_model}</span>
            </CfgRow>
          </>
        ) : (
          <p className="text-sm text-text-muted italic px-1 py-2">Loading model defaults…</p>
        )}
      </Panel>

      <p className="text-xs text-text-muted">
        In-flight loops are read-only. Global defaults — including the models above — live at{' '}
        <Link to="/research/config" className="text-accent hover:underline">/research/config</Link> and apply to new loops only.
      </p>
    </div>
  );
}

function CfgRow({
  label, hint, children, last, testId,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  last?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={clsx(
        'grid gap-3 items-center py-2.5',
        !last && 'border-b border-border-primary',
      )}
      style={{ gridTemplateColumns: 'minmax(180px, 260px) 1fr' }}
      data-testid={testId}
    >
      <div className="text-sm">
        <div className="text-text-primary font-medium">{label}</div>
        {hint && <div className="text-xs text-text-muted mt-0.5 leading-snug">{hint}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 min-w-0 text-sm">{children}</div>
    </div>
  );
}

function renderJsonValue(value: Record<string, unknown>): React.ReactNode {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return <span className="text-text-muted italic text-xs">empty</span>;
  }
  return (
    <pre className="font-mono text-xs text-text-secondary whitespace-pre-wrap m-0 max-w-full overflow-x-auto">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

// ---- Small helpers --------------------------------------------------------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-text-primary">{children}</dd>
    </>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-4 py-2 text-sm border-b-2 -mb-px transition-colors',
        active ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}

const STATUS_CLASS: Record<string, string> = {
  pending:   'bg-bg-tertiary text-text-secondary',
  running:   'bg-accent/15 text-accent',
  paused:    'bg-amber-500/15 text-amber-400',
  completed: 'bg-emerald-500/15 text-emerald-400',
  failed:    'bg-red-500/15 text-red-400',
  cancelled: 'bg-text-muted/15 text-text-muted',
};
function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', STATUS_CLASS[status] ?? STATUS_CLASS.pending)}
      data-testid="loop-status"
    >
      {status}
    </span>
  );
}

function formatTs(iso: string): string {
  // Display HH:MM:SS local from the engine-emit timestamp.
  try { return new Date(iso).toLocaleTimeString(); }
  catch { return iso.slice(11, 19); }
}

function summarizeEvent(f: StreamFrame): string {
  const p = f.payload as Record<string, unknown>;
  if (f.type === 'loop')       return `status=${p.status}${p.reason ? ` reason=${p.reason}` : ''}`;
  if (f.type === 'cycle')      return `idx=${p.index} status=${p.status}`;
  if (f.type === 'cycle_step') return `cycle=${p.cycle_index} step=${p.step} cached=${p.cached}`;
  if (f.type === 'milestone')  return `pct=${p.at_envelope_pct}`;
  if (f.type === 'artifact')   return `kind=${p.kind}`;
  if (f.type === 'decision')   return summarizeDecision(p as unknown as DecisionPayload);
  return '';
}

function formatShape(shape: OutputShape): string {
  switch (shape.kind) {
    case 'prose':    return 'prose';
    case 'list':     return `list (≥${shape.min_items ?? 5} items)`;
    case 'table':    return `table (${shape.columns.join(', ')})`;
    case 'timeline': return `timeline (≥${shape.min_events ?? 3} events)`;
    case 'mixed':    return `mixed: ${shape.components.map(formatShape).join(' + ')}`;
  }
}

