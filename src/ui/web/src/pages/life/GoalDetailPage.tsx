import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PRIORITY, GOAL_STATE } from '../../types';
import {
  useGoal,
  useNotes,
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
  useHistory,
  useUpdateGoal,
} from '../../api/hooks';
import { PriorityBadge, StateBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { CategoryManager } from '../../components/goals/CategoryManager';
import { NoteEditor } from '../../components/notes/NoteEditor';
import { HistoryTimeline } from '../../components/history/HistoryTimeline';
import { PageLoading } from '../../components/ui/Spinner';
import { cn } from '../../utils/cn';

const priorityOptions = PRIORITY.map((p) => ({
  value: p,
  label: p.charAt(0).toUpperCase() + p.slice(1),
}));

const stateOptions = GOAL_STATE.map((s) => ({
  value: s,
  label: s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
}));

function InlineEdit({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    if (draft.trim() && draft.trim() !== value) onSave(draft.trim());
    setEditing(false);
  }

  if (!editing) {
    return (
      <h1
        className="text-2xl font-bold text-text-primary cursor-pointer hover:text-accent group flex items-center gap-2"
        onClick={() => { setDraft(value); setEditing(true); }}
        title="Click to edit"
      >
        {value}
        <span className="text-text-muted text-base opacity-0 group-hover:opacity-100 transition-opacity">&#x270E;</span>
      </h1>
    );
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
      className="text-2xl font-bold bg-transparent border-b border-accent text-text-primary focus:outline-none w-full"
    />
  );
}

export function GoalDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [newNote, setNewNote] = useState('');

  const { data: goal, isLoading, isError } = useGoal(id);
  const { data: notes = [] } = useNotes(id);
  const { data: history = [] } = useHistory(id);

  const updateGoal = useUpdateGoal();
  const createNote = useCreateNote(id);
  const updateNote = useUpdateNote(id);
  const deleteNote = useDeleteNote(id);

  if (isLoading) {
    return <PageLoading />;
  }

  if (isError || !goal) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-text-secondary">Goal not found.</p>
        <Link to="/life/goals" className="text-accent hover:text-accent-hover hover:underline text-sm mt-2 inline-block">
          Back to goals
        </Link>
      </div>
    );
  }

  const isDone = goal.state === 'done';

  function handleUpdate(data: Partial<{ title: string; priority: string; state: string; archived: boolean }>) {
    updateGoal.mutate({ id, ...data });
  }

  function handleToggleDone() {
    handleUpdate({ state: isDone ? 'actionable' : 'done' });
  }

  function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!newNote.trim() || createNote.isPending) return;
    createNote.mutate({ content: newNote.trim() }, { onSuccess: () => setNewNote('') });
  }

  const sortedNotes = [...notes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {/* Back link */}
      <Link
        to="/life/goals"
        className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary transition-colors w-fit"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        All goals
      </Link>

      {/* Goal header */}
      <div className="bg-bg-secondary border border-border-primary rounded-lg p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          {/* Done toggle */}
          <button
            onClick={handleToggleDone}
            title={isDone ? 'Mark not done' : 'Mark done'}
            className={cn(
              'mt-1.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors',
              isDone
                ? 'border-success bg-success'
                : 'border-border-secondary hover:border-success'
            )}
          >
            {isDone && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 10 10">
                <path d="M1.5 5l2.5 2.5 4.5-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>

          <div className="flex-1 min-w-0">
            <InlineEdit value={goal.title} onSave={(title) => handleUpdate({ title })} />
          </div>

          {goal.archived && (
            <span className="px-2 py-0.5 rounded text-xs bg-bg-tertiary text-text-muted flex-shrink-0">
              archived
            </span>
          )}
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted">Priority</span>
            <select
              value={goal.priority}
              onChange={(e) => handleUpdate({ priority: e.target.value })}
              className="bg-transparent border-none text-xs focus:outline-none cursor-pointer text-text-secondary"
            >
              {priorityOptions.map((o) => (
                <option key={o.value} value={o.value} className="bg-bg-secondary">
                  {o.label}
                </option>
              ))}
            </select>
            <PriorityBadge priority={goal.priority} />
          </div>

          <span className="text-border-secondary">&middot;</span>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted">State</span>
            <select
              value={goal.state}
              onChange={(e) => handleUpdate({ state: e.target.value })}
              className="bg-transparent border-none text-xs focus:outline-none cursor-pointer text-text-secondary"
            >
              {stateOptions.map((o) => (
                <option key={o.value} value={o.value} className="bg-bg-secondary">
                  {o.label}
                </option>
              ))}
            </select>
            <StateBadge state={goal.state} />
          </div>

          <span className="text-border-secondary">&middot;</span>

          <button
            onClick={() => handleUpdate({ archived: !goal.archived })}
            className="text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            {goal.archived ? 'Unarchive' : 'Archive'}
          </button>
        </div>

        {/* Categories */}
        <div>
          <span className="text-xs text-text-muted block mb-1.5">Categories</span>
          <CategoryManager
            goalId={id}
            currentCategories={goal.categories ?? []}
          />
        </div>
      </div>

      {/* Notes section */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
          Notes
        </h2>

        {/* Add note form */}
        <form onSubmit={handleAddNote} className="flex flex-col gap-2">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note..."
            rows={3}
            className="w-full bg-bg-secondary border border-border-primary rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent resize-y"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (newNote.trim() && !createNote.isPending) {
                  createNote.mutate({ content: newNote.trim() }, { onSuccess: () => setNewNote('') });
                }
              }
            }}
          />
          <div className="flex justify-between items-center">
            <span className="text-xs text-text-muted">Ctrl/Cmd+Enter to submit</span>
            <Button
              type="submit"
              size="sm"
              loading={createNote.isPending}
              disabled={!newNote.trim()}
            >
              Add note
            </Button>
          </div>
        </form>

        {sortedNotes.length === 0 ? (
          <p className="text-sm text-text-muted py-2">No notes yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sortedNotes.map((note) => (
              <NoteEditor
                key={note.id}
                note={note}
                onSave={(noteId, content) => updateNote.mutate({ noteId, content })}
                onDelete={(noteId) => deleteNote.mutate(noteId)}
                saving={updateNote.isPending}
                deleting={deleteNote.isPending}
              />
            ))}
          </div>
        )}
      </section>

      {/* History section */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
          History
        </h2>
        <HistoryTimeline entries={history} />
      </section>
    </div>
  );
}
