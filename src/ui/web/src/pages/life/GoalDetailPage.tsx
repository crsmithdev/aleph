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
  useCreateTodo,
} from '../../api/hooks';
import { priorityColors, stateColors } from '../../components/ui/Badge';
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

type AddType = 'note' | 'todo';

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
  const [newContent, setNewContent] = useState('');
  const [addType, setAddType] = useState<AddType>('note');

  const { data: goal, isLoading, isError } = useGoal(id);
  const { data: notes = [] } = useNotes(id);
  const { data: history = [] } = useHistory(id);

  const updateGoal = useUpdateGoal();
  const createNote = useCreateNote(id);
  const createTodo = useCreateTodo();
  const updateNote = useUpdateNote(id);
  const deleteNote = useDeleteNote(id);

  if (isLoading) {
    return <PageLoading />;
  }

  if (isError || !goal) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-text-secondary">Goal not found.</p>
        <Link to="/goals" className="text-accent hover:text-accent-hover hover:underline text-sm mt-2 inline-block">
          Back to goals
        </Link>
      </div>
    );
  }

  const isDone = goal.state === 'done';

  function handleUpdate(data: Partial<{ title: string; priority: string; state: string; archived: boolean }>) {
    updateGoal.mutate({ id, ...data });
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newContent.trim()) return;
    if (addType === 'note') {
      if (createNote.isPending) return;
      createNote.mutate({ content: newContent.trim() }, { onSuccess: () => setNewContent('') });
    } else {
      if (createTodo.isPending) return;
      createTodo.mutate({ title: newContent.trim(), goalId: id }, { onSuccess: () => setNewContent('') });
    }
  }

  const sortedNotes = [...notes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {/* Back link */}
      <Link
        to="/goals"
        className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary transition-colors w-fit"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        All goals
      </Link>

      {/* Goal header */}
      <div className="bg-bg-secondary border border-border-primary rounded-lg p-5 flex flex-col gap-4">
        <InlineEdit value={goal.title} onSave={(title) => handleUpdate({ title })} />

        {/* Meta row — priority and state as colored selects, no duplicate badges */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={goal.priority}
            onChange={(e) => handleUpdate({ priority: e.target.value })}
            className={cn(
              'px-2 py-0.5 rounded text-xs font-medium border-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent appearance-none pr-5',
              priorityColors[goal.priority] ?? 'bg-bg-tertiary text-text-muted',
            )}
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath d='M0 2l4 4 4-4' fill='%23888'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
          >
            {priorityOptions.map((o) => (
              <option key={o.value} value={o.value} className="bg-bg-secondary text-text-primary">
                {o.label}
              </option>
            ))}
          </select>

          <select
            value={goal.state}
            onChange={(e) => handleUpdate({ state: e.target.value })}
            className={cn(
              'px-2 py-0.5 rounded text-xs font-medium capitalize border-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent appearance-none pr-5',
              stateColors[goal.state] ?? 'bg-bg-tertiary text-text-muted',
            )}
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath d='M0 2l4 4 4-4' fill='%23888'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
          >
            {stateOptions.map((o) => (
              <option key={o.value} value={o.value} className="bg-bg-secondary text-text-primary">
                {o.label}
              </option>
            ))}
          </select>
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

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Button
          variant={isDone ? 'secondary' : 'primary'}
          size="sm"
          onClick={() => handleUpdate({ state: isDone ? 'actionable' : 'done' })}
        >
          {isDone ? 'Reopen' : 'Finish'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleUpdate({ archived: !goal.archived })}
        >
          {goal.archived ? 'Unarchive' : 'Archive'}
        </Button>
      </div>

      {/* Add content section */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
            Add
          </h2>
          <div className="flex rounded-md overflow-hidden border border-border-primary">
            {(['note', 'todo'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setAddType(type)}
                className={cn(
                  'px-2.5 py-0.5 text-xs font-medium transition-colors capitalize',
                  addType === type
                    ? 'bg-accent text-white'
                    : 'bg-bg-secondary text-text-muted hover:text-text-secondary',
                )}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleAdd} className="flex flex-col gap-2">
          {addType === 'note' ? (
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Add a note..."
              rows={3}
              className="w-full bg-bg-secondary border border-border-primary rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent resize-y"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (newContent.trim()) handleAdd(e);
                }
              }}
            />
          ) : (
            <input
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Add a Todo..."
              className="w-full bg-bg-secondary border border-border-primary rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (newContent.trim()) handleAdd(e);
                }
              }}
            />
          )}
          <div className="flex justify-between items-center">
            <span className="text-xs text-text-muted">
              {addType === 'note' ? 'Ctrl/Cmd+Enter to submit' : 'Enter to submit'}
            </span>
            <Button
              type="submit"
              size="sm"
              loading={createNote.isPending || createTodo.isPending}
              disabled={!newContent.trim()}
            >
              Add {addType === 'todo' ? 'Todo' : 'note'}
            </Button>
          </div>
        </form>
      </section>

      {/* Notes section */}
      {sortedNotes.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
            Notes
          </h2>
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
        </section>
      )}

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
