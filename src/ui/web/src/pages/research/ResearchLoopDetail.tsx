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
        {tab === 'activity' && <ActivityTab events={events} cycleCount={snapshot.cycles.length} />}
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

function ActivityTab({ events, cycleCount }: { events: StreamFrame[]; cycleCount: number }) {
  if (events.length === 0) {
    return <p className="text-sm text-text-muted">No events yet — SSE connection just opened. Activity will populate as the engine runs.</p>;
  }
  return (
    <div className="max-w-4xl" data-testid="activity-tab">
      <p className="text-xs text-text-muted mb-3">{events.length} event{events.length !== 1 ? 's' : ''} · {cycleCount} cycle{cycleCount !== 1 ? 's' : ''} on this loop</p>
      <ul className="flex flex-col gap-0.5" data-testid="activity-event-list">
        {events.map((e, i) => (
          <li key={i} className="text-xs font-mono text-text-secondary flex gap-3 items-baseline py-0.5">
            <span className="text-text-muted shrink-0">{formatTs(e.logged_at)}</span>
            <span className="text-accent shrink-0 w-20">{e.type}</span>
            <span className="text-text-secondary">{summarizeEvent(e)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
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
