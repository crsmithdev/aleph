import { useState } from 'react';
import type { Note } from '@goal-tracker/shared';
import { Button } from '../ui/Button';

interface NoteEditorProps {
  note: Note;
  onSave: (noteId: string, content: string) => void;
  onDelete: (noteId: string) => void;
  saving?: boolean;
  deleting?: boolean;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NoteEditor({ note, onSave, onDelete, saving, deleting }: NoteEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);

  function handleSave() {
    if (!draft.trim()) return;
    onSave(note.id, draft.trim());
    setEditing(false);
  }

  function handleCancel() {
    setDraft(note.content);
    setEditing(false);
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 group">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500">{formatDateTime(note.createdAt)}</span>
        {!editing && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setDraft(note.content); setEditing(true); }}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={deleting}
              onClick={() => onDelete(note.id)}
              className="text-red-400 hover:text-red-300 hover:bg-red-950/30"
            >
              Delete
            </Button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            autoFocus
            className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={saving}
              disabled={!draft.trim()}
              onClick={handleSave}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
          {note.content}
        </p>
      )}
    </div>
  );
}
