import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUpdateTodo, useDeleteTodo } from '../../api/hooks';
import type { Todo } from '../../types';

interface TodoItemProps {
  todo: Todo & { goalTitle?: string };
}

export function TodoItem({ todo }: TodoItemProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleText, setTitleText] = useState(todo.title);
  const [expanded, setExpanded] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState(todo.note || '');
  const titleRef = useRef<HTMLInputElement>(null);
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();

  useEffect(() => {
    if (editingTitle) titleRef.current?.focus();
  }, [editingTitle]);

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

  return (
    <div className="group flex items-start gap-3 p-3 rounded-lg bg-bg-secondary border border-border-primary">
      <input
        type="checkbox"
        checked={todo.done}
        onChange={() => updateTodo.mutate({ id: todo.id, done: !todo.done })}
        className="mt-0.5 h-4 w-4 rounded border-border-secondary bg-bg-tertiary text-accent focus:ring-accent cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
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
              onClick={() => setEditingTitle(true)}
              onContextMenu={(e) => { e.preventDefault(); setExpanded(!expanded); }}
              role="button"
            >
              {todo.title}
            </span>
          )}
          {todo.goalTitle && todo.goalId && (
            <Link
              to={`/life/goals/${todo.goalId}`}
              className="text-xs text-text-muted hover:text-text-secondary truncate"
              onClick={(e) => e.stopPropagation()}
            >
              {todo.goalTitle}
            </Link>
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

      <button
        onClick={() => deleteTodo.mutate(todo.id)}
        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-error text-lg leading-none transition-opacity flex-shrink-0"
        title="Delete"
      >
        &times;
      </button>
    </div>
  );
}
