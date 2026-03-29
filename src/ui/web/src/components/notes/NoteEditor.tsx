import { useState, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Note } from '../../types';
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
  useEffect(() => setDraft(note.content), [note.content]);

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
    <div className="bg-bg-secondary border border-border-primary rounded-lg p-3 group">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-muted">{formatDateTime(note.createdAt)}</span>
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
            className="w-full bg-bg-tertiary border border-border-secondary rounded-md px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent resize-y"
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
        <div className="text-sm text-text-secondary leading-relaxed prose-sm max-w-none
          [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-text-primary [&_h1]:mt-3 [&_h1]:mb-1.5
          [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-text-primary [&_h2]:mt-2 [&_h2]:mb-1
          [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-1.5 [&_h3]:mb-0.5
          [&_p]:text-sm [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-2 [&_p:last-child]:mb-0
          [&_ul]:text-sm [&_ul]:text-text-secondary [&_ul]:ml-4 [&_ul]:mb-2 [&_ul]:list-disc
          [&_ol]:text-sm [&_ol]:text-text-secondary [&_ol]:ml-4 [&_ol]:mb-2 [&_ol]:list-decimal
          [&_li]:mb-0.5
          [&_code]:text-xs [&_code]:font-mono [&_code]:bg-bg-tertiary [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-accent
          [&_pre]:bg-bg-tertiary [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:mb-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0
          [&_strong]:font-semibold [&_strong]:text-text-primary
          [&_em]:italic
          [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-3 [&_blockquote]:text-text-muted [&_blockquote]:italic
          [&_a]:text-accent [&_a]:hover:underline
          [&_hr]:border-border-primary [&_hr]:my-2
        ">
          <Markdown remarkPlugins={[remarkGfm]}>{note.content}</Markdown>
        </div>
      )}
    </div>
  );
}
