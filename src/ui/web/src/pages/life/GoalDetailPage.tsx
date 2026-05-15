import { Icon } from '../../components/ui/Icon';
import { useState, useRef, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { PRIORITY, GOAL_STATE } from '../../types';
import type { Todo, Habit } from '../../types';
import {
  useGoal,
  useGoals,
  useNotes,
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
  useHistory,
  useUpdateGoal,
  useCreateTodo,
  useDeleteGoal,
  useTodos,
  useHabits,
  useUpdateTodo,
  useDeleteTodo,
  useUpdateHabit,
  useDeleteHabit,
  useCreateHabit,
  useLinkGoal,
  useUnlinkGoal,
} from '../../api/hooks';
import { priorityColors, stateColors } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { PageTitleLink, PageTitleSeparator } from '../../components/layout/PageHeader';
import { CategoryManager } from '../../components/goals/CategoryManager';
import { NoteEditor } from '../../components/notes/NoteEditor';
import { HistoryTimeline } from '../../components/history/HistoryTimeline';
import { PageLoading } from '../../components/ui/Spinner';
import { clsx } from 'clsx';

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
        className="font-heading text-2xl font-bold text-text-primary cursor-pointer hover:text-accent group flex items-center gap-2 min-w-0"
        onClick={() => { setDraft(value); setEditing(true); }}
        title="Click to edit"
      >
        <span className="truncate">{value}</span>
        <span className="text-text-muted text-base opacity-0 group-hover:opacity-100 transition-opacity shrink-0">&#x270E;</span>
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
      className="font-heading text-2xl font-bold bg-transparent border-b border-accent text-text-primary focus:outline-none focus:ring-1 focus:ring-accent w-full min-w-0"
    />
  );
}

function InlineAddRow({ placeholder, onSubmit, loading, linkSearch }: { placeholder: string; onSubmit: (v: string) => void; loading?: boolean; linkSearch?: React.ReactNode }) {
  const [value, setValue] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  if (addOpen) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim() || loading) return;
          onSubmit(value.trim());
          setValue('');
          setAddOpen(false);
        }}
        className="flex items-center gap-2"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoFocus
          className="flex-1 bg-bg-tertiary border border-border-secondary rounded px-2.5 py-1 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          onKeyDown={(e) => { if (e.key === 'Escape') { setValue(''); setAddOpen(false); } }}
        />
        <Button type="submit" size="sm" loading={loading} disabled={!value.trim()}>Add</Button>
        <button type="button" onClick={() => { setValue(''); setAddOpen(false); }} className="text-sm text-text-muted hover:text-text-secondary">Cancel</button>
      </form>
    );
  }

  if (linkOpen && linkSearch) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <button onClick={() => setLinkOpen(false)} className="text-sm text-text-muted hover:text-text-secondary">Close</button>
        </div>
        {linkSearch}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-0.5">
      <button
        onClick={() => setAddOpen(true)}
        className="flex items-center gap-1 text-sm text-text-muted hover:text-text-secondary transition-colors"
      >
        <span className="text-sm leading-none">+</span>
        {placeholder}
      </button>
      {linkSearch && (
        <>
          <span className="text-border-primary text-sm">|</span>
          <button
            onClick={() => setLinkOpen(true)}
            className="flex items-center gap-1 text-sm text-text-muted hover:text-text-muted transition-colors"
          >
            <Icon name="open_in_new" size="xs" />
            Link existing
          </button>
        </>
      )}
    </div>
  );
}

function LinkSearch<T extends { id: string; title: string }>({
  items,
  completedItems,
  onLink,
  renderExtra,
}: {
  items: T[];
  completedItems?: T[];
  onLink: (item: T) => void;
  renderExtra?: (item: T) => React.ReactNode;
}) {
  const [filter, setFilter] = useState('');
  const [includeCompleted, setIncludeCompleted] = useState(false);

  const pool = includeCompleted && completedItems ? [...items, ...completedItems] : items;
  const filtered = pool.filter((item) =>
    item.title.toLowerCase().includes(filter.toLowerCase()),
  );
  const showToggle = (completedItems?.length ?? 0) > 0;

  return (
    <>
      <div className="flex items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search..."
          autoFocus
          className="flex-1 bg-bg-tertiary border border-border-secondary rounded px-2.5 py-1 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {showToggle && (
          <label className="flex items-center gap-1.5 text-sm text-text-muted whitespace-nowrap cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeCompleted}
              onChange={(e) => setIncludeCompleted(e.target.checked)}
              className="accent-accent"
            />
            Include completed
          </label>
        )}
      </div>
      <div className="overflow-y-auto max-h-[150px] flex flex-col gap-0.5">
        {filtered.length === 0 ? (
          <p className="text-sm text-text-muted py-1 px-2">No matches.</p>
        ) : (
          filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => onLink(item)}
              className="text-left text-sm text-text-secondary hover:text-text-primary px-2 py-1 rounded hover:bg-bg-tertiary transition-colors flex items-center justify-between"
            >
              <span>{item.title}</span>
              {renderExtra?.(item)}
            </button>
          ))
        )}
      </div>
    </>
  );
}

type LinkableGoal = { id: string; title: string; state: string };

function GoalLinkRow({ linkableGoals, completedLinkableGoals, onLink }: { linkableGoals: LinkableGoal[]; completedLinkableGoals: LinkableGoal[]; onLink: (g: LinkableGoal) => void }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 text-sm text-text-muted hover:text-text-secondary transition-colors"
        >
          <Icon name="open_in_new" size="xs" />
          Link a goal
        </button>
      </div>
    );
  }

  const hasAny = linkableGoals.length > 0 || completedLinkableGoals.length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen(false)} className="text-sm text-text-muted hover:text-text-secondary">Close</button>
      </div>
      {hasAny ? (
        <LinkSearch
          items={linkableGoals}
          completedItems={completedLinkableGoals}
          onLink={(g) => { onLink(g); setOpen(false); }}
          renderExtra={(g) => <span className="text-text-muted text-sm capitalize">{g.state.replace(/_/g, ' ')}</span>}
        />
      ) : (
        <p className="text-sm text-text-muted py-1 px-2">No other goals to link.</p>
      )}
    </div>
  );
}

export function GoalDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [noteContent, setNoteContent] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: goal, isLoading, isError } = useGoal(id);
  const { data: notes = [] } = useNotes(id);
  const { data: history = [] } = useHistory(id);
  const { data: todosData } = useTodos(true);
  const { data: habitsData = [] } = useHabits();
  const { data: allGoals = [] } = useGoals();

  const updateGoal = useUpdateGoal();
  const linkGoal = useLinkGoal(id);
  const unlinkGoal = useUnlinkGoal(id);
  const createNote = useCreateNote(id);
  const createTodo = useCreateTodo();
  const updateNote = useUpdateNote(id);
  const deleteNote = useDeleteNote(id);
  const deleteGoal = useDeleteGoal();
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();
  const createHabit = useCreateHabit();
  const updateHabit = useUpdateHabit();
  const deleteHabit = useDeleteHabit();

  if (isLoading) return <PageLoading />;

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

  function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteContent.trim() || createNote.isPending) return;
    createNote.mutate({ content: noteContent.trim() }, { onSuccess: () => setNoteContent('') });
  }

  function handleDeleteGoal() {
    deleteGoal.mutate(id, { onSuccess: () => navigate('/goals') });
  }

  const sortedNotes = [...notes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const allTodos = [...(todosData?.active ?? []), ...(todosData?.completed ?? [])];
  const linkedTodos = allTodos.filter((t) => t.goalId === id);
  const unlinkedTodos = allTodos.filter((t) => !t.goalId && !t.done);
  const completedUnlinkedTodos = allTodos.filter((t) => !t.goalId && t.done);

  const linkedHabits = habitsData.filter((h: Habit) => h.goalId === id);
  const unlinkedHabits = habitsData.filter((h: Habit) => !h.goalId);

  const linkedGoalIds = new Set((goal.linkedGoals ?? []).map((g) => g.id));
  const linkableGoalsAll = allGoals.filter((g) => g.id !== id && !linkedGoalIds.has(g.id));
  const linkableGoals = linkableGoalsAll.filter((g) => g.state !== 'done' && g.state !== 'canceled');
  const completedLinkableGoals = linkableGoalsAll.filter((g) => g.state === 'done' || g.state === 'canceled');

  return (
    <div className="flex flex-col gap-6">
      {/* Goal header */}
      <div className="sticky top-0 z-10 h-14 bg-bg-primary border-b border-border-primary flex items-center gap-2">
        <PageTitleLink to="/goals">Goals</PageTitleLink>
        <PageTitleSeparator />
        <div className="flex-1 min-w-0">
          <InlineEdit value={goal.title} onSave={(title) => handleUpdate({ title })} />
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
            <CategoryManager goalId={id} currentCategories={goal.categories ?? []} />
            <select
              value={goal.priority}
              onChange={(e) => handleUpdate({ priority: e.target.value })}
              className={clsx(
                'px-2 py-1 rounded text-sm font-medium border-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent appearance-none pr-5',
                priorityColors[goal.priority] ?? 'bg-bg-tertiary text-text-muted',
              )}
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath d='M0 2l4 4 4-4' fill='%23888'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
            >
              {priorityOptions.map((o) => (
                <option key={o.value} value={o.value} className="bg-bg-secondary text-text-primary">{o.label}</option>
              ))}
            </select>
            <select
              value={goal.state}
              onChange={(e) => handleUpdate({ state: e.target.value })}
              className={clsx(
                'px-2 py-1 rounded text-sm font-medium capitalize border-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent appearance-none pr-5',
                stateColors[goal.state] ?? 'bg-bg-tertiary text-text-muted',
              )}
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath d='M0 2l4 4 4-4' fill='%23888'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
            >
              {stateOptions.map((o) => (
                <option key={o.value} value={o.value} className="bg-bg-secondary text-text-primary">{o.label}</option>
              ))}
            </select>
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
        <Button variant="ghost" size="sm" onClick={() => handleUpdate({ archived: !goal.archived })}>
          {goal.archived ? 'Unarchive' : 'Archive'}
        </Button>
        {confirmDelete ? (
          <div className="flex items-center gap-2 ml-2">
            <span className="text-sm text-text-muted">Delete this goal?</span>
            <button onClick={handleDeleteGoal} className="text-sm text-red-400 hover:text-red-300 font-medium">Confirm</button>
            <button onClick={() => setConfirmDelete(false)} className="text-sm text-text-muted hover:text-text-secondary">Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-sm text-red-400 hover:text-red-300 hover:bg-red-950/30 px-2 py-1 rounded transition-colors"
          >
            Delete
          </button>
        )}
      </div>

      {/* Notes section — with inline add */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">Notes</h2>
        <form onSubmit={handleAddNote} className="flex flex-col gap-2">
          <textarea
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            placeholder="Write a note..."
            rows={2}
            className="w-full bg-bg-secondary border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent resize-y"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (noteContent.trim()) handleAddNote(e);
              }
            }}
          />
          <div className="flex justify-between items-center">
            <span className="text-sm text-text-muted">Ctrl/Cmd+Enter to submit</span>
            <Button type="submit" size="sm" loading={createNote.isPending} disabled={!noteContent.trim()}>Add note</Button>
          </div>
        </form>
        {sortedNotes.length > 0 && (
          <div className="flex flex-col gap-2 mt-1">
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

      {/* Todos section — with inline add + link */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">Todos</h2>
        {linkedTodos.length > 0 && (
          <div className="flex flex-col gap-1">
            {linkedTodos.map((todo) => (
              <div key={todo.id} className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border border-border-primary rounded group">
                <span className={clsx('flex-1 text-sm', todo.done ? 'line-through text-text-muted' : 'text-text-primary')}>
                  {todo.title}
                </span>
                {todo.dueDate && (
                  <span className={clsx('text-sm', todo.dueDate < new Date().toISOString().slice(0, 10) ? 'text-red-400' : 'text-text-muted')}>
                    {new Date(todo.dueDate + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                )}
                <button
                  onClick={() => updateTodo.mutate({ id: todo.id, goalId: null })}
                  className="text-sm text-text-muted hover:text-text-secondary px-1.5 py-0.5 rounded hover:bg-bg-tertiary transition-colors"
                >
                  Unlink
                </button>
                <button
                  onClick={() => deleteTodo.mutate(todo.id)}
                  className="text-sm text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded hover:bg-red-950/30 transition-colors"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
        <InlineAddRow
          placeholder="Add todo"
          onSubmit={(title) => createTodo.mutate({ title, goalId: id })}
          loading={createTodo.isPending}
          linkSearch={unlinkedTodos.length + completedUnlinkedTodos.length > 0 ? (
            <LinkSearch
              items={unlinkedTodos}
              completedItems={completedUnlinkedTodos}
              onLink={(todo) => updateTodo.mutate({ id: todo.id, goalId: id })}
            />
          ) : undefined}
        />
      </section>

      {/* Habits section — with link */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">Habits</h2>
        {linkedHabits.length > 0 && (
          <div className="flex flex-col gap-1">
            {linkedHabits.map((habit) => (
              <div key={habit.id} className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border border-border-primary rounded group">
                <span className="flex-1 text-sm text-text-primary">{habit.title}</span>
                <span className="text-sm text-text-muted">{habit.frequency}</span>
                <button
                  onClick={() => updateHabit.mutate({ id: habit.id, goalId: null })}
                  className="text-sm text-text-muted hover:text-text-secondary px-1.5 py-0.5 rounded hover:bg-bg-tertiary transition-colors"
                >
                  Unlink
                </button>
                <button
                  onClick={() => deleteHabit.mutate(habit.id)}
                  className="text-sm text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded hover:bg-red-950/30 transition-colors"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
        <InlineAddRow
          placeholder="Add habit"
          onSubmit={(title) => createHabit.mutate({ title, frequency: 'daily', goalId: id })}
          loading={createHabit.isPending}
          linkSearch={unlinkedHabits.length > 0 ? (
            <LinkSearch
              items={unlinkedHabits}
              onLink={(habit) => updateHabit.mutate({ id: habit.id, goalId: id })}
              renderExtra={(habit) => <span className="text-text-muted text-sm">{habit.frequency}</span>}
            />
          ) : undefined}
        />
      </section>

      {/* Related Goals section */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">Related Goals</h2>
        {(goal.linkedGoals ?? []).length > 0 && (
          <div className="flex flex-col gap-1">
            {(goal.linkedGoals ?? []).map((linked) => (
              <div key={linked.id} className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border border-border-primary rounded group">
                <Link
                  to={`/goals/${linked.id}`}
                  className="flex-1 text-sm text-text-primary hover:text-accent transition-colors"
                >
                  {linked.title}
                </Link>
                <span className="text-sm text-text-muted capitalize">{linked.state.replace(/_/g, ' ')}</span>
                <button
                  onClick={() => unlinkGoal.mutate(linked.id)}
                  className="text-sm text-text-muted hover:text-text-secondary px-1.5 py-0.5 rounded hover:bg-bg-tertiary transition-colors"
                >
                  Unlink
                </button>
              </div>
            ))}
          </div>
        )}
        <GoalLinkRow linkableGoals={linkableGoals} completedLinkableGoals={completedLinkableGoals} onLink={(g) => linkGoal.mutate(g.id)} />
      </section>

      {/* History section */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">History</h2>
        <HistoryTimeline entries={history} />
      </section>
    </div>
  );
}
