import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUpdateTodo, useDeleteTodo, usePromoteTodo } from '../../api/hooks';
import type { Todo } from '../../types';

interface TodoItemProps {
  todo: Todo & { goalTitle?: string };
}

function formatDueDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getDueDateStatus(dateStr: string | null): 'overdue' | 'today' | 'future' | null {
  if (!dateStr) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr < today) return 'overdue';
  if (dateStr === today) return 'today';
  return 'future';
}

export function TodoItem({ todo }: TodoItemProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleText, setTitleText] = useState(todo.title);
  const [expanded, setExpanded] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState(todo.note || '');
  const [editingDueDate, setEditingDueDate] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dueDateRef = useRef<HTMLInputElement>(null);
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();
  const promoteTodo = usePromoteTodo();

  useEffect(() => {
    if (editingTitle) titleRef.current?.focus();
  }, [editingTitle]);

  useEffect(() => {
    if (editingDueDate) dueDateRef.current?.focus();
  }, [editingDueDate]);

  const saveTitle = () => {
    const trimmed = titleText.trim();
    if (trimmed && trimmed !== todo.title) {
      updateTodo.mutate({ id: todo.id, title: trimmed });
    } else {
      setTitleText(todo.title);
    }
    setEditingTitle(false);
  };

  const saveNote = () => {
    updateTodo.mutate({ id: todo.id, note: noteText || null });
    setEditingNote(false);
  };

  const saveDueDate = (value: string) => {
    updateTodo.mutate({ id: todo.id, dueDate: value || null });
    setEditingDueDate(false);
  };

  const clearDueDate = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateTodo.mutate({ id: todo.id, dueDate: null });
  };

  const dueDateStatus = getDueDateStatus(todo.dueDate);
  const dueDateColorClass =
    dueDateStatus === 'overdue' ? 'text-error' :
    dueDateStatus === 'today' ? 'text-accent' :
    'text-text-muted';

  return (
    <div className="group flex items-center gap-3 p-3 rounded-lg bg-bg-secondary border border-border-primary">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {editingTitle ? (
            <input
              ref={titleRef}
              value={titleText}
              onChange={(e) => setTitleText(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle();
                if (e.key === 'Escape') { setTitleText(todo.title); setEditingTitle(false); }
              }}
              className="flex-1 bg-bg-tertiary border border-border-secondary rounded px-2 py-0.5 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
          ) : (
            <span
              className={`text-sm cursor-pointer ${todo.done ? 'line-through text-text-muted' : 'text-text-primary'}`}
              onClick={() => !todo.done && setEditingTitle(true)}
              onContextMenu={(e) => { e.preventDefault(); setExpanded(!expanded); }}
              role="button"
            >
              {todo.title}
            </span>
          )}
        </div>

        {expanded && (
          <div className="mt-2">
            {editingNote ? (
              <div className="flex gap-2">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  className="flex-1 bg-bg-tertiary border border-border-secondary rounded px-2 py-1 text-sm text-text-primary resize-none focus:outline-none focus:border-accent"
                  rows={2}
                  autoFocus
                />
                <div className="flex flex-col gap-1">
                  <button onClick={saveNote} className="text-xs text-accent hover:text-accent-hover">Save</button>
                  <button
                    onClick={() => { setNoteText(todo.note || ''); setEditingNote(false); }}
                    className="text-xs text-text-muted hover:text-text-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="text-xs text-text-muted cursor-pointer hover:text-text-secondary mt-1 min-h-4"
                onClick={() => setEditingNote(true)}
              >
                {todo.note || 'Click to add note...'}
              </div>
            )}
          </div>
        )}
      </div>

      {editingDueDate ? (
        <input
          ref={dueDateRef}
          type="date"
          defaultValue={todo.dueDate ?? ''}
          onBlur={(e) => saveDueDate(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveDueDate((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') setEditingDueDate(false);
          }}
          className="text-xs bg-bg-tertiary border border-border-secondary rounded px-1.5 py-0.5 text-text-primary focus:outline-none focus:border-accent flex-shrink-0"
        />
      ) : todo.dueDate ? (
        <div className={`flex items-center gap-1 flex-shrink-0 ${dueDateColorClass}`}>
          <span
            className="text-xs cursor-pointer hover:opacity-80"
            onClick={() => !todo.done && setEditingDueDate(true)}
            title={dueDateStatus === 'overdue' ? 'Overdue' : dueDateStatus === 'today' ? 'Due today' : 'Scheduled'}
          >
            {formatDueDate(todo.dueDate)}
          </span>
          {!todo.done && (
            <button
              onClick={clearDueDate}
              className="text-text-muted hover:text-error leading-none opacity-0 group-hover:opacity-100 transition-opacity"
              title="Clear due date"
            >
              ×
            </button>
          )}
        </div>
      ) : !todo.done ? (
        <button
          onClick={() => setEditingDueDate(true)}
          className="text-xs text-text-muted hover:text-text-secondary flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Set due date"
        >
          + date
        </button>
      ) : null}

      {todo.goalTitle && todo.goalId && (
        <Link
          to={`/goals/${todo.goalId}`}
          className="text-xs text-text-muted hover:text-text-secondary truncate max-w-[12rem] flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {todo.goalTitle}
        </Link>
      )}

      {!todo.done && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => promoteTodo.mutate(todo.id)}
            className="p-1 rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
            title="Promote to goal"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
            </svg>
          </button>
          <button
            onClick={() => updateTodo.mutate({ id: todo.id, done: true })}
            className="p-1 rounded text-text-muted hover:text-success hover:bg-success/10 transition-colors"
            title="Complete"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </button>
          <button
            onClick={() => deleteTodo.mutate(todo.id)}
            className="p-1 rounded text-text-muted hover:text-error hover:bg-error/10 transition-colors"
            title="Delete"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
