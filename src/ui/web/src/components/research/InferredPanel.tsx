import { clsx } from 'clsx';
import {
  type QuestionShape,
  type ShapeAnalysis,
  type TopicClusterAnalysis,
  type RunPlan,
} from '../../api/research-hooks';

const SHAPE_TOOLTIPS: Record<QuestionShape, string> = {
  survey: 'Overview / breadth — wants canonical examples',
  timeline: 'Chronological events',
  list: 'Enumerated items with completeness',
  dynamics: 'Causal narrative — how/why',
  comparison: 'Axes with parity per side',
  lookup: 'Single fact with source',
  audit: 'Checklist + verification',
};

function ShapeChip({ shape, criterion }: { shape: QuestionShape; criterion?: string }) {
  const tooltip = criterion ? `${SHAPE_TOOLTIPS[shape]}\n\n${criterion}` : SHAPE_TOOLTIPS[shape];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm font-medium border capitalize whitespace-nowrap',
        'bg-accent/10 text-accent border-accent/30',
      )}
      title={tooltip}
    >
      {shape}
    </span>
  );
}

interface InferredPanelProps {
  /** Null = pre-detection (show "Detecting…"). Populated = render rows. */
  shape: ShapeAnalysis | null;
  topic: TopicClusterAnalysis | null;
  runPlan: RunPlan | null;
  onEditShape?: () => void;
  onEditLenses?: () => void;
  onEditTopic?: () => void;
  onEditRunPlan?: () => void;
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-text-muted hover:text-accent text-xs hover:underline shrink-0"
    >
      edit
    </button>
  );
}

/** Four-row inferred-metadata block under the compose textarea. Mirrors
 *  the QuestionShapeBar chip vocabulary so the override UI is the same on
 *  both surfaces. Pre-detection state is a quiet "Detecting…" line so the
 *  block doesn't flash empty rows. */
export function InferredPanel({ shape, topic, runPlan, onEditShape, onEditLenses, onEditTopic, onEditRunPlan }: InferredPanelProps) {
  // Pre-detection: shape detector hasn't run yet. Don't render the four-row
  // block — the planner needs the shape before topic/runPlan are useful.
  if (!shape) {
    return (
      <div className="mt-3 bg-bg-primary border border-border-primary rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2.5 text-sm text-text-muted">
          <span
            className="w-1.5 h-1.5 rounded-full bg-accent"
            style={{ animation: 'pulse 1.4s ease-in-out infinite' }}
          />
          <span>Detecting question shape…</span>
        </div>
      </div>
    );
  }

  const lensByShape = new Map(shape.lenses.map(l => [l.shape, l.criterion]));

  return (
    <div className="mt-3 bg-bg-primary border border-border-primary rounded-lg overflow-hidden">
      {/* Shape row */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border-primary text-sm min-h-[42px]">
        <span className="font-mono text-xs uppercase tracking-wider text-text-muted shrink-0 w-[76px]">Shape</span>
        <span className="flex-1 min-w-0 flex flex-wrap gap-1.5">
          {shape.shapes.length === 0 ? (
            <span className="text-text-muted italic">none detected</span>
          ) : (
            shape.shapes.map(s => (
              <ShapeChip key={s} shape={s} criterion={lensByShape.get(s)} />
            ))
          )}
        </span>
        <span className="ml-auto flex gap-2.5 items-center shrink-0">
          {shape.confidence > 0 && (
            <span className="font-mono text-xs text-text-muted tabular-nums" title="Detector confidence (0–1)">
              conf {shape.confidence.toFixed(2)}
            </span>
          )}
          {onEditShape && <EditButton onClick={onEditShape} />}
        </span>
      </div>

      {/* Lenses row */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border-primary text-sm min-h-[42px]">
        <span className="font-mono text-xs uppercase tracking-wider text-text-muted shrink-0 w-[76px]">Lenses</span>
        <span className="flex-1 min-w-0 text-xs text-text-muted">
          {shape.lenses.length === 0 ? (
            <span className="italic">none</span>
          ) : (
            shape.lenses.map((l, i) => (
              <span key={l.shape}>
                {i > 0 && <span className="mx-1">·</span>}
                <em className="text-text-secondary not-italic">{l.shape}</em>
                <span>: {l.criterion || <span className="italic">no criterion</span>}</span>
              </span>
            ))
          )}
        </span>
        {onEditLenses && shape.lenses.length > 0 && <EditButton onClick={onEditLenses} />}
      </div>

      {/* Topic row */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border-primary text-sm min-h-[42px]">
        <span className="font-mono text-xs uppercase tracking-wider text-text-muted shrink-0 w-[76px]">Topic</span>
        <span className="flex-1 min-w-0">
          {topic ? (
            <>
              <span className="text-accent">{topic.cluster}</span>
              {topic.confidence > 0 && (
                <span className="ml-2 text-xs text-text-muted tabular-nums" title="Classifier confidence (0–1)">
                  conf {topic.confidence.toFixed(2)}
                </span>
              )}
            </>
          ) : (
            <span className="text-text-muted italic">classifying…</span>
          )}
        </span>
        {onEditTopic && topic && <EditButton onClick={onEditTopic} />}
      </div>

      {/* Run plan row */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm min-h-[42px]">
        <span className="font-mono text-xs uppercase tracking-wider text-text-muted shrink-0 w-[76px]">Run plan</span>
        <span className="flex-1 min-w-0 text-xs">
          {runPlan ? (
            <>
              <span className="text-text-muted">model</span>{' '}
              <span className="font-mono text-text-secondary">{runPlan.model_fast}</span>
              <span className="text-text-muted ml-3">budget</span>{' '}
              <span className="font-mono text-text-secondary">${runPlan.budget_total_usd.toFixed(2)}</span>
              <span className="text-text-muted ml-3">depth</span>{' '}
              <span className="font-mono text-text-secondary">{runPlan.max_thread_depth} hops</span>
              <span className="text-text-muted ml-3">role</span>{' '}
              <span className="font-mono text-text-secondary">{runPlan.role_label}</span>
            </>
          ) : (
            <span className="text-text-muted italic">computing…</span>
          )}
        </span>
        {onEditRunPlan && runPlan && <EditButton onClick={onEditRunPlan} />}
      </div>
    </div>
  );
}
