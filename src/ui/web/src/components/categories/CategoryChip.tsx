import { Icon } from '../ui/Icon';

export function CategoryChip({
  name,
  color,
  onRemove,
  onColorClick,
}: {
  name: string;
  color?: string | null;
  onRemove?: () => void;
  onColorClick?: () => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium"
      style={
        color
          ? { backgroundColor: `${color}20`, color }
          : { backgroundColor: 'rgb(55 65 81)', color: 'rgb(156 163 175)' }
      }
    >
      {onColorClick && (
        <button
          onClick={(e) => { e.stopPropagation(); onColorClick(); }}
          className="w-2 h-2 rounded-full flex-shrink-0 hover:scale-150 transition-transform"
          style={{ backgroundColor: color ?? 'rgb(107 114 128)' }}
          title="Change color"
        />
      )}
      {name}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity flex items-center"
          aria-label={`Remove ${name}`}
        >
          <Icon name="close" size="xs" />
        </button>
      )}
    </span>
  );
}
