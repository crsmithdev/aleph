import { useState, useRef, useEffect } from 'react';
import type { Category } from '@goal-tracker/shared';
import { useCategories, useSetGoalCategories } from '../../api/hooks';
import { CategoryChip } from '../categories/CategoryChip';

interface CategoryManagerProps {
  goalId: string;
  currentCategories: Category[];
}

export function CategoryManager({ goalId, currentCategories }: CategoryManagerProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { data: allCategories = [] } = useCategories();
  const setCategories = useSetGoalCategories(goalId);

  const currentIds = new Set(currentCategories.map((c) => c.id));
  const available = allCategories.filter((c) => !currentIds.has(c.id));

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function remove(catId: string) {
    const next = currentCategories.filter((c) => c.id !== catId).map((c) => c.id);
    setCategories.mutate(next);
  }

  function add(catId: string) {
    setCategories.mutate([...Array.from(currentIds), catId]);
    setOpen(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {currentCategories.map((cat) => (
        <CategoryChip
          key={cat.id}
          name={cat.name}
          color={cat.color}
          onRemove={() => remove(cat.id)}
        />
      ))}

      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs text-gray-500 border border-gray-700 border-dashed hover:border-gray-500 hover:text-gray-400 transition-colors"
        >
          <span className="text-base leading-none">+</span> Add
        </button>

        {open && (
          <div className="absolute top-full left-0 mt-1 z-20 bg-gray-800 border border-gray-700 rounded-lg shadow-xl min-w-40 py-1">
            {available.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-500">No more categories</p>
            ) : (
              available.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => add(cat.id)}
                  className="w-full text-left px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors"
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: cat.color ?? 'rgb(107 114 128)' }}
                  />
                  {cat.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
