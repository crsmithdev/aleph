/**
 * Loop detail page — three panels (Activity, Schedule, Artifact). Activity is
 * the first-class surface per principles §Observability. Initial state comes
 * from GET /loops/:id; live updates come from /loops/:id/stream (SSE).
 *
 * Temporary route. Phase 6 absorbs this into the v1 UI rewrite (Schedule view
 * as universal editor, 8-mode row, etc.).
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageLoading } from '../../components/ui/Spinner';

// Phase 3 shape taxonomy — must stay in sync with src/research/src/loop/types.ts.
type OutputShape =
  | { kind: 'prose' }
  | { kind: 'list'; min_items?: number }
  | { kind: 'table'; columns: string[] }
  | { kind: 'timeline'; min_events?: number }
  | { kind: 'mixed'; components: OutputShape[] };

interface Loop {
  id: string;
  template_id: string;
  status: string;
  envelope: Record<string, unknown>;
  envelope_consumed: Record<string, number>;
  prompt: string;
  created_at: string;
  updated_at: string;
}
interface Cycle {
  id: string;
  index: number;
  status: string;
}
interface Artifact {
  id: string;
  kind: string;
  cycle_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}
interface StreamFrame {
  type: 'loop' | 'cycle' | 'cycle_step' | 'milestone' | 'artifact';
  payload: Record<string, unknown>;
  ts: string;
}

export function LoopDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [snapshot, setSnapshot] = useState<{ loop: Loop; cycles: Cycle[]; artifacts: Artifact[] } | null>(null);
  const [events, setEvents] = useState<StreamFrame[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  // SSE — appends every event to the activity list and patches the snapshot
  // for loop/cycle status changes. When the loop reaches a terminal status,
  // re-fetch the snapshot once so cycles/artifacts/milestones reflect final state
  // (the engine only emits loop/cycle/cycle_step/milestone — artifact rows
  // are written but not pushed as events to keep the bus narrow).
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const source = new EventSource(`/api/loops/${id}/stream`);
    source.onmessage = e => {
      try {
        const frame = JSON.parse(e.data) as { type: StreamFrame['type']; payload: Record<string, unknown> };
        const ts = new Date().toISOString();
        setEvents(prev => [...prev, { ...frame, ts }]);
        if (frame.type === 'loop') {
          const incoming = frame.payload as Partial<Loop>;
          setSnapshot(prev => prev ? { ...prev, loop: { ...prev.loop, ...incoming } } : prev);
          const status = incoming.status;
          if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            void fetch(`/api/loops/${id}`)
              .then(r => r.ok ? r.json() : null)
              .then(data => { if (data && !cancelled) setSnapshot(data as typeof snapshot); })
              .catch(() => { /* ignore */ });
          }
        }
      } catch { /* skip malformed */ }
    };
    return () => { cancelled = true; source.close(); };
  }, [id]);

  if (loadError) return <ErrorState message={loadError} />;
  if (!snapshot) return <PageLoading />;

  const { loop, cycles, artifacts } = snapshot;
  const cycleOutputs = artifacts.filter(a => a.kind === 'cycle_output');
  const latestCycle = cycleOutputs.at(-1);
  const schedule = artifacts.find(a => a.kind === 'schedule');
  const outputShape = (schedule?.payload as { output_shape?: OutputShape } | undefined)?.output_shape;
  const latestRender = latestCycle?.payload?.render as
    | { shape_kind?: string; shape_satisfied?: boolean; shape_missing?: unknown; findings?: unknown[]; sources?: Array<{ url: string; title: string }> }
    | undefined;
  // Prefer the latest cycle that produced actual text — monitor's wait-cycles
  // have no text, so the literal-latest cycle isn't always the most useful.
  const substantiveProcessor =
    [...cycleOutputs].reverse()
      .map(a => a.payload?.processor as { text?: string; query?: string; kind?: string; source_meta?: Array<{ url: string; title: string }> } | undefined)
      .find(p => p?.text && p.text.length > 0);
  const latestProcessorKind = (latestCycle?.payload?.processor as { kind?: string } | undefined)?.kind;
  const title = loop.prompt?.trim().length ? loop.prompt : `Loop ${loop.id.slice(0, 8)}`;
  const idShort = loop.id.slice(0, 8);

  return (
    <div className="flex flex-col gap-5" data-testid="page-loop-detail">
      <div>
        <Link to="/research" className="text-sm text-accent hover:underline">&larr; New research</Link>
        <PageHeader
          title={title}
          subtitle={<>{loop.template_id} · <span className="font-mono">{idShort}</span> · status <span data-testid="loop-status">{loop.status}</span> · {cycles.length} cycles</>}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr] gap-4">
        <Panel title="Activity" testid="loop-activity">
          {events.length === 0 ? (
            <p className="text-sm text-text-muted">Waiting for events…</p>
          ) : (
            <ul className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto" data-testid="loop-activity-list">
              {events.map((e, i) => (
                <li key={i} className="text-xs font-mono text-text-secondary">
                  <span className="text-text-muted">{e.ts.slice(11, 19)} </span>
                  <span className="text-accent">{e.type}</span>{' '}
                  {summarize(e)}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Schedule" testid="loop-schedule">
          <dl className="text-sm text-text-secondary grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-text-muted">Template</dt>
            <dd>{loop.template_id}</dd>
            <dt className="text-text-muted">Status</dt>
            <dd>{loop.status}</dd>
            <dt className="text-text-muted">Shape</dt>
            <dd data-testid="loop-shape">
              {outputShape ? formatShape(outputShape) : <span className="text-text-muted">—</span>}
              {latestRender?.shape_satisfied !== undefined && outputShape?.kind !== 'prose' && (
                <span className={`ml-2 text-xs ${latestRender.shape_satisfied ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {latestRender.shape_satisfied ? '✓ satisfied' : '⋯ unsatisfied'}
                </span>
              )}
            </dd>
            <dt className="text-text-muted">Envelope</dt>
            <dd className="font-mono text-xs">{JSON.stringify(loop.envelope) || '{}'}</dd>
            <dt className="text-text-muted">Consumed</dt>
            <dd className="font-mono text-xs">{JSON.stringify(loop.envelope_consumed)}</dd>
          </dl>
        </Panel>

        <Panel title="Artifact" testid="loop-artifact">
          {substantiveProcessor?.text ? (
            <div className="text-sm text-text-secondary">
              {substantiveProcessor.query && (
                <p className="text-xs text-text-muted mb-2">
                  Query: <span className="font-mono">{substantiveProcessor.query}</span>
                </p>
              )}
              <div className="prose prose-sm max-w-none prose-headings:text-text-primary prose-p:text-text-secondary prose-li:text-text-secondary prose-table:text-text-secondary prose-strong:text-text-primary">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{substantiveProcessor.text}</ReactMarkdown>
              </div>
              {substantiveProcessor.source_meta && substantiveProcessor.source_meta.length > 0 && (
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-text-muted">
                    Sources ({substantiveProcessor.source_meta.length})
                  </summary>
                  <ul className="mt-1 ml-4 list-disc">
                    {substantiveProcessor.source_meta.map((s, i) => (
                      <li key={i}>
                        <a href={s.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                          {s.title || s.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {substantiveProcessor.source_meta && substantiveProcessor.source_meta.length === 0 && (
                <p className="mt-3 text-xs text-amber-600">
                  No web sources for this cycle — answer may be hallucinated.
                </p>
              )}
            </div>
          ) : latestProcessorKind ? (
            <p className="text-sm text-text-muted">
              Latest cycle: <span className="font-mono">{latestProcessorKind}</span> (no text yet).
            </p>
          ) : (
            <p className="text-sm text-text-muted">No artifact yet.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** Render an OutputShape as a short human-readable label. */
function formatShape(shape: OutputShape): string {
  switch (shape.kind) {
    case 'prose':
      return 'prose';
    case 'list':
      return `list (≥${shape.min_items ?? 5} items)`;
    case 'table':
      return `table (${shape.columns.join(', ')})`;
    case 'timeline':
      return `timeline (≥${shape.min_events ?? 3} events)`;
    case 'mixed':
      return `mixed: ${shape.components.map(formatShape).join(' + ')}`;
  }
}

function Panel({ title, children, testid }: { title: string; children: React.ReactNode; testid: string }) {
  return (
    <section className="bg-bg-secondary border border-border-primary rounded-lg p-4" data-testid={testid}>
      <h2 className="text-xs uppercase tracking-wide text-text-muted mb-3">{title}</h2>
      {children}
    </section>
  );
}

function summarize(frame: StreamFrame): string {
  const p = frame.payload;
  if (frame.type === 'loop') return `status=${p.status}${p.reason ? ` reason=${p.reason}` : ''}`;
  if (frame.type === 'cycle') return `idx=${p.index} status=${p.status}`;
  if (frame.type === 'cycle_step') return `cycle=${p.cycle_index} step=${p.step} cached=${p.cached}`;
  if (frame.type === 'milestone') return `pct=${p.at_envelope_pct}`;
  if (frame.type === 'artifact') return `kind=${p.kind}`;
  return '';
}
