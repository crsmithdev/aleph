import { clsx } from 'clsx';

export function Select({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={className}>
      {label && (
        <label className="block text-xs text-text-muted mb-1">{label}</label>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(
          'w-full bg-bg-tertiary border border-border-primary rounded-md',
          'px-2.5 py-1.5 text-sm text-text-primary',
          'focus:outline-none focus:ring-1 focus:ring-accent'
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
