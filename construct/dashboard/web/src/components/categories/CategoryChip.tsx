export function CategoryChip({
  name,
  color,
  onRemove,
}: {
  name: string;
  color?: string | null;
  onRemove?: () => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
      style={
        color
          ? { backgroundColor: `${color}20`, color }
          : { backgroundColor: 'rgb(55 65 81)', color: 'rgb(209 213 219)' }
      }
    >
      {name}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 opacity-60 hover:opacity-100 leading-none transition-opacity"
          aria-label={`Remove ${name}`}
        >
          ×
        </button>
      )}
    </span>
  );
}
