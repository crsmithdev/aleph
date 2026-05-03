import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  useCreateResearchQuery,
  useResearchQuery,
  useSuggestedRunPlan,
  useUpdateResearchQuery,
  type QuestionShape,
  type ResearchQuery,
  type ShapeAnalysis,
  type ShapeLens,
} from '../../api/research-hooks';
import { InferredPanel } from './InferredPanel';

const ALL_SHAPES: QuestionShape[] = [
  'survey', 'timeline', 'list', 'dynamics', 'comparison', 'lookup', 'audit',
];

const TEMPLATES: { label: string; prompt: string }[] = [
  { label: 'timeline', prompt: 'Timeline of ' },
  { label: 'comparison', prompt: 'Compare ' },
  { label: 'survey', prompt: 'Overview of ' },
  { label: 'dynamics', prompt: 'How does ' },
  { label: 'audit', prompt: 'Is ' },
];

/** Hero compose box on the research landing page. Submits the prompt
 *  immediately, then polls the new query until shape + topic detection
 *  populate. Shape detection happens fire-and-forget on the server at
 *  query creation. The user can keep editing or just navigate to the
 *  detail page; either way the run is already created. */
export function ComposeBox() {
  const [prompt, setPrompt] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [editingShape, setEditingShape] = useState(false);
  const navigate = useNavigate();
  const createQuery = useCreateResearchQuery();
  const updateQuery = useUpdateResearchQuery();

  // Poll the created query until shape and topic populate. Shape detector
  // is fire-and-forget at session creation, so we poll instead of SSE
  // (consistent with the existing detail-page pattern).
  const { data: createdQuery } = useResearchQuery(createdId ?? '');
  const shape = createdQuery?.question_shape ?? null;
  const topic = createdQuery?.topic_cluster ?? null;
  const primaryShape: QuestionShape | null = shape?.shapes[0] ?? null;
  const { data: runPlan = null } = useSuggestedRunPlan(
    primaryShape,
    topic?.cluster ?? null,
  );

  // Once both shape and topic land, the inferred panel is fully populated;
  // the user can act on it or open the detail page. We don't auto-navigate —
  // some users will want to tweak the prompt and re-submit before opening
  // the run; ⌘↵ is the explicit "open detail" gesture.
  const isDetecting = createdId != null && (!shape || !topic);

  function reset() {
    setPrompt('');
    setCreatedId(null);
    setEditingShape(false);
  }

  function handleSubmit(e: React.FormEvent | undefined, openDetail = false) {
    if (e) e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || createQuery.isPending) return;
    createQuery.mutate(
      { prompt: trimmed },
      {
        onSuccess: q => {
          if (openDetail) {
            navigate(`/research/${q.id}`);
            reset();
          } else {
            setCreatedId(q.id);
          }
        },
      },
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(undefined, e.metaKey || e.ctrlKey);
    }
  }

  function applyTemplate(t: { label: string; prompt: string }) {
    setPrompt(p => (p ? p : t.prompt));
  }

  return (
    <section
      className={clsx(
        'rounded-xl border border-accent/30 px-6 pt-5 pb-4',
        'bg-gradient-to-b from-accent/[0.08] to-bg-secondary',
      )}
    >
      <h2 className="font-heading text-lg font-semibold text-text-primary mb-3">
        What do you want to investigate?
      </h2>

      <form onSubmit={e => handleSubmit(e, false)}>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="A timeline of how Detroit techno crossed the Atlantic — labels, DJs, pivotal venues 1986–94. Compare the Berlin and Frankfurt feedback loops…"
          className="w-full min-h-[120px] bg-bg-primary border border-border-primary rounded-lg px-4 py-3.5 text-base text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y leading-relaxed"
          disabled={createQuery.isPending || createdId !== null}
        />

        {/* Inferred panel: appears once a query is created. While shape/topic
            haven't landed yet, the panel itself shows the "Detecting…" line. */}
        {createdId !== null && createdQuery && (
          editingShape && shape ? (
            <ShapeEditorInline
              query={createdQuery}
              initial={shape}
              onCancel={() => setEditingShape(false)}
              onSave={next => {
                updateQuery.mutate({ id: createdQuery.id, question_shape: next });
                setEditingShape(false);
              }}
            />
          ) : (
            <InferredPanel
              shape={shape}
              topic={topic}
              runPlan={runPlan}
              onEditShape={shape ? () => setEditingShape(true) : undefined}
            />
          )
        )}

        <div className="flex items-center gap-3 mt-3.5 flex-wrap">
          {createdId === null ? (
            <>
              <button
                type="submit"
                className="bg-accent text-bg-primary border-0 px-5 py-2 text-sm font-semibold rounded-md hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!prompt.trim() || createQuery.isPending}
              >
                {createQuery.isPending ? 'Starting…' : 'Start research →'}
              </button>
              <span className="text-xs text-text-muted">
                ↵ to start · ⌘↵ to start &amp; open detail
              </span>
              <span className="ml-auto flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted self-center">
                  Start from:
                </span>
                {TEMPLATES.map(t => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    className="text-xs px-2.5 py-1 border border-dashed border-border-secondary rounded text-text-secondary hover:text-text-primary hover:border-accent capitalize"
                  >
                    {t.label}
                  </button>
                ))}
              </span>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => createdId && navigate(`/research/${createdId}`)}
                className="bg-accent text-bg-primary border-0 px-5 py-2 text-sm font-semibold rounded-md hover:bg-accent-hover"
              >
                Open detail →
              </button>
              <button
                type="button"
                onClick={reset}
                className="text-sm text-text-muted hover:text-text-primary px-3 py-2"
              >
                + New query
              </button>
              {isDetecting && (
                <span className="text-xs text-text-muted">Detection in progress…</span>
              )}
            </>
          )}
        </div>
      </form>
    </section>
  );
}

interface ShapeEditorInlineProps {
  query: ResearchQuery;
  initial: ShapeAnalysis;
  onSave: (next: ShapeAnalysis) => void;
  onCancel: () => void;
}

/** Inline shape editor matching QuestionShapeBar's ShapeEditor — lets the
 *  user toggle which shapes apply. Reused here so the override UI is
 *  identical on both surfaces (landing compose + detail page). */
function ShapeEditorInline({ initial, onSave, onCancel }: ShapeEditorInlineProps) {
  const [selected, setSelected] = useState<Set<QuestionShape>>(new Set(initial.shapes));
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  function toggle(s: QuestionShape) {
    const next = new Set(selected);
    if (next.has(s)) next.delete(s); else next.add(s);
    setSelected(next);
  }

  function handleSave() {
    const lensByShape = new Map(initial.lenses.map(l => [l.shape, l]));
    const lenses: ShapeLens[] = Array.from(selected).map(s =>
      lensByShape.get(s) ?? { shape: s, criterion: '' }
    );
    onSave({ shapes: Array.from(selected), lenses, confidence: initial.confidence });
  }

  return (
    <div ref={containerRef} className="mt-3 flex flex-col gap-2 border border-border-primary rounded-lg p-3 bg-bg-secondary">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-text-muted">Shapes:</span>
        {ALL_SHAPES.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => toggle(s)}
            className={clsx(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm font-medium border capitalize transition-colors',
              selected.has(s)
                ? 'bg-accent/10 text-accent border-accent/30'
                : 'bg-bg-tertiary text-text-muted border-border-primary',
              'hover:bg-accent/15 cursor-pointer',
            )}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="px-3 py-1 rounded bg-accent text-bg-primary text-sm hover:bg-accent-hover"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 rounded text-sm text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
