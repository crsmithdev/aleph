import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useUpdateTodo, useDeleteTodo } from '../../api/hooks';
import { api } from '../../api/client';
import type { Todo } from '@goal-tracker/shared';

interface TodoItemProps {
  todo: Todo & { goalTitle?: string };
  isOverdue?: boolean;
}

export function TodoItem({ todo, isOverdue }: TodoItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState(todo.note || '');
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();

  const saveNote = async () => {
    await api.patch(`/todos/${todo.id}`, { note: noteText || null });
    setEditingNote(false);
    // Invalidation happens on the next useTodos refetch; for immediate feedback we just close
  };

  return (
    <div
      className={`group flex items-start gap-3 p-3 rounded-lg bg-gray-900 border border-gray-800 ${
        isOverdue && !todo.done ? 'border-l-2 border-l-red-500' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={todo.done}
        onChange={() => updateTodo.mutate({ id: todo.id, completed: !todo.done })}
        className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500 cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-sm cursor-pointer ${todo.done ? 'line-through text-gray-500' : 'text-gray-200'}`}
            onClick={() => setExpanded(!expanded)}
            role="button"
          >
            {todo.title}
          </span>
          {isOverdue && !todo.done && (
            <span className="text-xs text-red-400 font-medium">overdue</span>
          )}
          {todo.goalTitle && todo.goalId && (
            <Link
              to={`/goals/${todo.goalId}`}
              className="text-xs text-gray-500 hover:text-gray-300 truncate"
              onClick={(e) => e.stopPropagation()}
            >
              {todo.goalTitle}
            </Link>
          )}
          {todo.dueDate && (
            <span className="text-xs text-gray-600">
              {new Date(todo.dueDate + 'T00:00:00').toLocaleDateString()}
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
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 resize-none focus:outline-none focus:border-blue-600"
                  rows={2}
                  autoFocus
                />
                <div className="flex flex-col gap-1">
                  <button
                    onClick={saveNote}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setNoteText(todo.note || '');
                      setEditingNote(false);
                    }}
                    className="text-xs text-gray-400 hover:text-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="text-xs text-gray-400 cursor-pointer hover:text-gray-300 mt-1 min-h-4"
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
        className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-lg leading-none transition-opacity flex-shrink-0"
        title="Delete"
      >
        &times;
      </button>
    </div>
  );
}
