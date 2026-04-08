import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUpdateTodo, useDeleteTodo, usePromoteTodo } from '../../api/hooks';
import type { Todo } from '../../types';
import { Icon } from '../ui/Icon';

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
  const promoteTodo = usePromoteTodo();

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
            <Icon name="arrow_upward" size="sm" />
          </button>
          <button
            onClick={() => updateTodo.mutate({ id: todo.id, done: true })}
            className="p-1 rounded text-text-muted hover:text-success hover:bg-success/10 transition-colors"
            title="Complete"
          >
            <Icon name="check" size="sm" />
          </button>
          <button
            onClick={() => deleteTodo.mutate(todo.id)}
            className="p-1 rounded text-text-muted hover:text-error hover:bg-error/10 transition-colors"
            title="Delete"
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      )}
    </div>
  );
}
