import { useState } from 'react';
import { clsx } from 'clsx';
import {
  useUpdateResearchQuery,
  type QuestionShape,
  type ResearchQuery,
  type ShapeAnalysis,
  type ShapeLens,
} from '../../api/research-hooks';

const ALL_SHAPES: QuestionShape[] = [
  'survey', 'timeline', 'list', 'dynamics', 'comparison', 'lookup', 'audit',
];

const SHAPE_TOOLTIPS: Record<QuestionShape, string> = {
  survey: 'Overview / breadth — wants canonical examples',
  timeline: 'Chronological events',
  list: 'Enumerated items with completeness',
  dynamics: 'Causal narrative — how/why',
  comparison: 'Axes with parity per side',
  lookup: 'Single fact with source',
  audit: 'Checklist + verification',
};

function shapeChipClasses(active: boolean, clickable: boolean): string {
  return clsx(
    'inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm font-medium border capitalize whitespace-nowrap transition-colors',
    active
      ? 'bg-accent/10 text-accent border-accent/30'
      : 'bg-bg-tertiary text-text-muted border-border-primary',
    clickable && 'hover:bg-accent/15 cursor-pointer',
  );
}

interface ChipProps {
  shape: QuestionShape;
  criterion?: string;
  active: boolean;
  onClick?: () => void;
}

function ShapeChip({ shape, criterion, active, onClick }: ChipProps) {
  const tooltip = criterion ? `${SHAPE_TOOLTIPS[shape]}\n\n${criterion}` : SHAPE_TOOLTIPS[shape];
  const cls = shapeChipClasses(active, !!onClick);
  return onClick ? (
    <button type="button" onClick={onClick} className={cls} title={tooltip}>{shape}</button>
  ) : (
    <span className={cls} title={tooltip}>{shape}</span>
  );
}

/** Bar shown under the prompt that displays the detected question shapes
 *  (survey/timeline/list/dynamics/comparison/lookup/audit) with their
 *  completeness criteria, plus an edit affordance to add or remove shapes. */
export function QuestionShapeBar({ session }: { session: ResearchQuery }) {
  const updateQuery = useUpdateResearchQuery();
  const [editing, setEditing] = useState(false);
  const shape = session.question_shape;

  // Pre-detection: show a quiet placeholder. The detector runs fire-and-forget
  // at session creation; users typically see the chips populate within a few
  // seconds of submitting the prompt.
  if (!shape) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <span>Detecting question shape…</span>
      </div>
    );
  }

  if (editing) {
    return (
      <ShapeEditor
        initial={shape}
        onCancel={() => setEditing(false)}
        onSave={(next) => {
          updateQuery.mutate({ id: session.id, question_shape: next });
          setEditing(false);
        }}
      />
    );
  }

  const lensByShape = new Map(shape.lenses.map(l => [l.shape, l.criterion]));
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="text-text-muted">Shape:</span>
      {shape.shapes.length === 0 ? (
        <span className="text-text-muted italic">none detected</span>
      ) : (
        shape.shapes.map(s => (
          <ShapeChip key={s} shape={s} criterion={lensByShape.get(s)} active />
        ))
      )}
      {shape.confidence > 0 && (
        <span
          className="text-text-muted tabular-nums"
          title="Detector confidence (0–1)"
        >
          {shape.confidence.toFixed(2)}
        </span>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="ml-auto text-text-muted hover:text-accent text-sm underline-offset-2 hover:underline"
      >
        Edit
      </button>
    </div>
  );
}

interface EditorProps {
  initial: ShapeAnalysis;
  onSave: (next: ShapeAnalysis) => void;
  onCancel: () => void;
}

/** Inline editor: toggle which shapes apply. Existing criteria are preserved
 *  for shapes that stay selected. Newly toggled-on shapes get an empty
 *  criterion (the planner falls back to a generic strategy until a criterion
 *  is supplied). Removing a shape drops its lens. */
function ShapeEditor({ initial, onSave, onCancel }: EditorProps) {
  const [selected, setSelected] = useState<Set<QuestionShape>>(new Set(initial.shapes));

  function toggle(s: QuestionShape) {
    const next = new Set(selected);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setSelected(next);
  }

  function handleSave() {
    const lensByShape = new Map(initial.lenses.map(l => [l.shape, l]));
    const lenses: ShapeLens[] = Array.from(selected).map(s =>
      lensByShape.get(s) ?? { shape: s, criterion: '' }
    );
    onSave({
      shapes: Array.from(selected),
      lenses,
      confidence: initial.confidence,
    });
  }

  return (
    <div className="flex flex-col gap-2 border border-border-primary rounded p-2 bg-bg-secondary">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-text-muted">Shapes:</span>
        {ALL_SHAPES.map(s => (
          <ShapeChip key={s} shape={s} active={selected.has(s)} onClick={() => toggle(s)} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="px-3 py-1 rounded bg-accent text-bg-primary text-sm hover:bg-accent/90"
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
