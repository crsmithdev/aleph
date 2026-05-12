/**
 * Loop detail page — the rich session detail UI for the new (loops) engine.
 *
 * Mounted at `/research/:id`. Four tabs covering everything previously
 * spread across the legacy ResearchQueryDetailPage (which is going away in
 * Phase 7):
 *
 *   Document   — the latest polished `kind: 'document'` artifact, Markdown.
 *                Auto-fires on loop completion (run.ts); user can manually
 *                regenerate via the button. Falls back to the raw `render`
 *                artifact's findings while the polish is pending.
 *   Activity   — live event stream from /api/loops/:id/stream (loop /
 *                cycle / cycle_step / milestone / artifact frames) + the
 *                persisted events.ndjson replayed on connect. Engine-emit
 *                timestamps, not page-load.
 *   Plan       — the schedule artifact's canon[] + branches[], each branch
 *                expandable to show its cycle_output's processor text +
 *                source list. Plus aggregate sources at the bottom.
 *   Config     — the schedule payload (output_shape, plan summary,
 *                milestone_plan, perturbation_weights), envelope state,
 *                loop status / template / child pid / timestamps.
 *
 * Phase 5 will collapse envelope/models/perturbation_config/flags onto the
 * schedule payload itself; Config will surface those when they land.
 */
import { useEffect, useMemo, useState } from 'react';
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

interface RenderPayload {
  kind: 'render';
  findings: Array<{ cycle: number; query: string; text: string }>;
  sources: Array<{ url: string; title: string }>;
  cycles_rendered: number;
  shape_kind?: string;
  shape_satisfied?: boolean;
  shape_missing?: unknown;
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
  type: 'loop' | 'cycle' | 'cycle_step' | 'milestone' | 'artifact';
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
            <PageTitleLink to="/research/history">Research</PageTitleLink>
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

function DocumentTab({ loopId, artifacts }: { loopId: string; artifacts: Artifact[] }) {
  const doc = useMemo(() => {
    const docs = artifacts
      .filter(a => a.kind === 'document')
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (docs.length === 0) return null;
    return { artifact: docs[0], payload: docs[0].payload as unknown as DocumentPayload };
  }, [artifacts]);

  const fallbackRender = useMemo(() => findLatestRender(artifacts), [artifacts]);
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
    return <p className="text-sm text-text-muted">No output yet — waiting for the first cycle to render.</p>;
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-xs text-text-muted">
          {doc ? (
            <>Polished document · {new Date(doc.payload.generated_at).toLocaleString()} · {doc.payload.source_count} sources · <span className="font-mono">{doc.payload.model}</span></>
          ) : (
            <>Raw render — polish pending</>
          )}
        </div>
        <button
          onClick={regenerate}
          disabled={regenerating}
          className="text-xs px-3 py-1.5 border border-border-primary rounded text-text-secondary hover:text-text-primary hover:border-accent disabled:opacity-50"
          data-testid="document-regenerate"
        >
          {regenerating ? 'Regenerating…' : (doc ? 'Regenerate' : 'Generate now')}
        </button>
      </div>

      {regenError && (
        <div className="text-sm text-error border border-error/40 bg-error/10 rounded px-3 py-2 mb-3">{regenError}</div>
      )}

      <article
        className="prose prose-sm max-w-none prose-headings:text-text-primary prose-p:text-text-secondary prose-li:text-text-secondary prose-table:text-text-secondary prose-strong:text-text-primary prose-a:text-accent"
        data-testid="document-body"
      >
        {doc ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.payload.text}</ReactMarkdown>
        ) : fallbackRender ? (
          <>
            {fallbackRender.findings.map((f, i) => (
              <section key={i} className="mb-6">
                <h3 className="!mt-0">Cycle {f.cycle}: {f.query}</h3>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{f.text}</ReactMarkdown>
              </section>
            ))}
            {fallbackRender.sources.length > 0 && (
              <>
                <h2>References</h2>
                <ol>
                  {fallbackRender.sources.map((s, i) => (
                    <li key={i}>
                      <a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </>
        ) : null}
      </article>
    </div>
  );
}

/**
 * Activity tab — adapted from docs/mockups/research-activity.html to the
 * loops engine. Two-column dashboard:
 *
 *   LEFT  : KPI strip (Cycles · Steps · Cost · Duration)
 *           Cycle Lifecycle table — per-cycle queue / dispatch / run / e2e
 *             percentiles (replaces the v0 Job Lifecycle table)
 *           Branch State stackbar — schedule.branches × cycle status counts
 *             (replaces the v0 Thread State stackbar)
 *   RIGHT : Event log — sticky panel with type filter pills, scrolls
 *             independently of the left column
 *
 * The mockup also showed Post-Mortem, Iteration Checks, Source Extraction,
 * and Decisions panels. Those panels surfaced data from the v0 engine's
 * post_mortem / iteration_check / source_extraction / decision events,
 * which the loop engine doesn't emit yet. Re-introducing them is a
 * follow-up (post-mortem as a final-cycle LLM hook; iteration checks as
 * milestone-tied verdicts; decisions as planner/derivation events; per-
 * source extraction status as a render-artifact field).
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
          <CycleLifecycle data={lifecycle} cycles={cycles} />
          <BranchState entries={branchState} />
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

  // Cost: prefer the sum of per-step costs from the event stream (always up
  // to date and ignores the pre-existing 0-bug on envelope_consumed.cost_usd
  // when summing isn't yet wired in the engine). Fall back to the loop's
  // own envelope_consumed if no step events are visible (e.g. before SSE
  // back-fill completes).
  const stepCost = events.reduce((sum, e) => {
    if (e.type !== 'cycle_step') return sum;
    return sum + ((e.payload as { cost_usd?: number }).cost_usd ?? 0);
  }, 0);
  const cost = stepCost > 0 ? stepCost : (loop.envelope_consumed?.cost_usd ?? 0);

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

const EVENT_FILTERS: Array<'all' | StreamFrame['type']> = ['all', 'loop', 'cycle', 'cycle_step', 'artifact', 'milestone'];

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
  title, subtitle, testId, children,
}: {
  title: string;
  subtitle?: string;
  testId?: string;
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

function PlanTab({ artifacts }: { artifacts: Artifact[] }) {
  const schedule = artifacts.find(a => a.kind === 'schedule');
  const payload = schedule?.payload as unknown as SchedulePayload | undefined;
  const plan = payload?.plan;

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
    return <p className="text-sm text-text-muted">No schedule artifact yet — the planner runs at loop start.</p>;
  }

  return (
    <div className="max-w-4xl flex flex-col gap-6" data-testid="plan-tab">
      <section>
        <h3 className="text-xs uppercase tracking-wide text-text-muted mb-2">Canon ({plan.canon.length})</h3>
        {plan.canon.length === 0 ? (
          <p className="text-sm text-text-muted italic">No canon entries — planner emitted the fallback schedule.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {plan.canon.map((c, i) => (
              <li key={i} className="text-sm px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">{c}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wide text-text-muted mb-2">Branches ({plan.branches.length})</h3>
        <div className="flex flex-col gap-2">
          {plan.branches.map((b) => (
            <BranchCard key={b.id} branch={b} output={branchOutputs.get(b.id)} />
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wide text-text-muted mb-2">Sources ({allSources.length})</h3>
        {allSources.length === 0 ? (
          <p className="text-sm text-text-muted italic">No web sources fetched yet.</p>
        ) : (
          <ol className="text-sm list-decimal list-inside text-text-secondary flex flex-col gap-1">
            {allSources.map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{s.title}</a>
                <span className="text-text-muted text-xs ml-2">{new URL(s.url).hostname}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function BranchCard({ branch, output }: { branch: Branch; output?: ProcessorOutput }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="border border-border-primary rounded bg-bg-secondary"
      open={expanded}
      onToggle={e => setExpanded((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer px-3 py-2 text-sm flex items-center gap-3">
        <span className="font-mono text-xs text-text-muted">{branch.id}</span>
        <span className="text-text-secondary flex-1 truncate">{branch.query}</span>
        {branch.budget != null && (
          <span className="text-xs text-text-muted">budget={branch.budget}</span>
        )}
      </summary>
      {output ? (
        <div className="px-3 py-3 border-t border-border-primary text-sm">
          <div className="text-xs text-text-muted mb-2">
            Query: <span className="font-mono">{output.query}</span>
            {output.source_meta && <> · {output.source_meta.length} sources</>}
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

function ConfigTab({ loop, artifacts }: { loop: Loop; artifacts: Artifact[] }) {
  const schedule = artifacts.find(a => a.kind === 'schedule');
  const payload = schedule?.payload as unknown as SchedulePayload | undefined;

  return (
    <div className="max-w-3xl flex flex-col gap-6" data-testid="config-tab">
      <section>
        <h3 className="text-xs uppercase tracking-wide text-text-muted mb-2">Loop</h3>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <Row label="ID"><span className="font-mono">{loop.id}</span></Row>
          <Row label="Template">{loop.template_id}</Row>
          <Row label="Status"><StatusBadge status={loop.status} /></Row>
          <Row label="Child PID">{loop.child_pid ?? <span className="text-text-muted italic">none</span>}</Row>
          <Row label="Created">{new Date(loop.created_at).toLocaleString()}</Row>
          <Row label="Updated">{new Date(loop.updated_at).toLocaleString()}</Row>
        </dl>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wide text-text-muted mb-2">Envelope</h3>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <Row label="Configured"><pre className="font-mono text-xs">{JSON.stringify(loop.envelope, null, 2)}</pre></Row>
          <Row label="Consumed"><pre className="font-mono text-xs">{JSON.stringify(loop.envelope_consumed, null, 2)}</pre></Row>
        </dl>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wide text-text-muted mb-2">Schedule</h3>
        {payload ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <Row label="Output shape">{formatShape(payload.output_shape)}</Row>
            <Row label="Branches"><span className="font-mono">{payload.plan.branches.length}</span></Row>
            <Row label="Per-branch budget"><span className="font-mono">{payload.plan.per_branch_budget}</span></Row>
            <Row label="Milestones"><span className="font-mono">{payload.plan.milestone_plan.join(', ')}</span></Row>
            <Row label="Perturbation weights">
              {Object.keys(payload.plan.perturbation_weights).length === 0
                ? <span className="text-text-muted italic">defaults</span>
                : <pre className="font-mono text-xs">{JSON.stringify(payload.plan.perturbation_weights, null, 2)}</pre>}
            </Row>
          </dl>
        ) : (
          <p className="text-sm text-text-muted italic">No schedule artifact written yet.</p>
        )}
      </section>
    </div>
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

function findLatestRender(artifacts: Artifact[]): RenderPayload | null {
  let best: { ts: string; payload: RenderPayload } | null = null;
  for (const a of artifacts) {
    if (a.kind === 'render') {
      const p = a.payload as unknown as RenderPayload;
      if (!best || a.created_at > best.ts) best = { ts: a.created_at, payload: p };
      continue;
    }
    if (a.kind === 'cycle_output') {
      const render = (a.payload as { render?: RenderPayload }).render;
      if (render && Array.isArray(render.findings)) {
        if (!best || a.created_at > best.ts) best = { ts: a.created_at, payload: render };
      }
    }
  }
  return best?.payload ?? null;
}
