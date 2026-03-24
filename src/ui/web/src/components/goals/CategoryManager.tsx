import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Category } from '../../types';
import { useCategories, useSetGoalCategories, useCreateCategory, useUpdateCategory } from '../../api/hooks';
import { CategoryChip } from '../categories/CategoryChip';
import { ColorDots, PRESET_COLORS } from '../categories/ColorDots';

interface CategoryManagerProps {
  goalId: string;
  currentCategories: Category[];
}

export function CategoryManager({ goalId, currentCategories }: CategoryManagerProps) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[4]);
  const [editingColorId, setEditingColorId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: allCategories = [] } = useCategories();
  const setCategories = useSetGoalCategories(goalId);
  const qc = useQueryClient();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();

  const currentIds = new Set(currentCategories.map((c) => c.id));
  const available = allCategories.filter((c) => !currentIds.has(c.id));

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setNewName('');
        setEditingColorId(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function remove(catId: string) {
    const next = currentCategories.filter((c) => c.id !== catId).map((c) => c.id);
    setCategories.mutate(next);
  }

  function add(catId: string) {
    setCategories.mutate([...Array.from(currentIds), catId]);
    setOpen(false);
    setNewName('');
    setEditingColorId(null);
  }

  function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    createCategory.mutate({ name: trimmed, color: newColor }, {
      onSuccess: (created) => {
        setNewName('');
        setNewColor(PRESET_COLORS[4]);
        setCategories.mutate([...Array.from(currentIds), created.id]);
        setOpen(false);
      },
    });
  }

  function handleColorEdit(catId: string, color: string) {
    updateCategory.mutate({ id: catId, color }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: ['goals', goalId] }),
    });
    setEditingColorId(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" ref={containerRef}>
      {currentCategories.map((cat) => (
        <div key={cat.id} className="relative">
          <CategoryChip
            name={cat.name}
            color={cat.color}
            onRemove={() => remove(cat.id)}
            onColorClick={() => setEditingColorId(editingColorId === cat.id ? null : cat.id)}
          />
          {editingColorId === cat.id && (
            <div className="absolute top-full left-0 mt-1 z-20 bg-bg-tertiary border border-border-secondary rounded-lg shadow-xl p-2">
              <ColorDots
                selected={cat.color}
                onSelect={(color) => handleColorEdit(cat.id, color)}
              />
            </div>
          )}
        </div>
      ))}

      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs text-text-muted border border-border-secondary border-dashed hover:border-border-primary hover:text-text-secondary transition-colors"
        >
          <span className="text-base leading-none">+</span> Add
        </button>

        {open && (
          <div className="absolute top-full left-0 mt-1 z-20 bg-bg-tertiary border border-border-secondary rounded-lg shadow-xl min-w-48 py-1">
            {available.map((cat) => (
              <button
                key={cat.id}
                onClick={() => add(cat.id)}
                className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-secondary flex items-center gap-2 transition-colors"
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: cat.color ?? 'rgb(107 114 128)' }}
                />
                {cat.name}
              </button>
            ))}
            <div className="border-t border-border-secondary mt-1 pt-2 px-2 pb-1 space-y-2">
              <ColorDots selected={newColor} onSelect={setNewColor} />
              <input
                ref={inputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') { setOpen(false); setNewName(''); }
                }}
                placeholder="New category..."
                className="w-full bg-bg-secondary border border-border-primary rounded px-2 py-1 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
