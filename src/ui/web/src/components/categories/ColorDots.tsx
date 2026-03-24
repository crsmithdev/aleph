import { cn } from '../../utils/cn';

const PRESET_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
];

export { PRESET_COLORS };

export function ColorDots({
  selected,
  onSelect,
  size = 'sm',
}: {
  selected?: string | null;
  onSelect: (color: string) => void;
  size?: 'sm' | 'md';
}) {
  const dotSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4.5 h-4.5';
  return (
    <div className="flex items-center gap-1">
      {PRESET_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={(e) => { e.stopPropagation(); onSelect(color); }}
          className={cn(
            'rounded-full flex-shrink-0 transition-all',
            dotSize,
            selected === color
              ? 'ring-2 ring-offset-1 ring-offset-bg-tertiary'
              : 'hover:scale-125'
          )}
          style={{
            backgroundColor: color,
            ...(selected === color ? { ringColor: color } : {}),
          }}
          title={color}
        />
      ))}
    </div>
  );
}
