import { clsx } from 'clsx';
import { Icon } from '../ui/Icon';

export function humanizeFlag(flag: string): string {
  return flag.replace(/_/g, ' ');
}

interface FlagChipProps {
  flags: string[];
  /** ISO timestamp of the snapshot. Renders into the tooltip. */
  createdAt?: string | null;
  size?: 'sm' | 'md';
  /** Optional click handler — e.g. jump to the Reviews tab. */
  onClick?: () => void;
  className?: string;
}

/** Compact flag indicator. Renders a single yellow chip whose label is the
 *  first flag (count appended when there are more). The full list is in the
 *  tooltip. Used in the detail-page header and on listing cards. */
export function FlagChip({ flags, createdAt, size = 'sm', onClick, className }: FlagChipProps) {
  if (!flags || flags.length === 0) return null;

  const first = humanizeFlag(flags[0]);
  const rest = flags.length - 1;
  const label = rest > 0 ? `${first} +${rest}` : first;

  const tooltip = [
    flags.map(humanizeFlag).join('\n'),
    createdAt ? `\nas of ${new Date(createdAt).toLocaleString()}` : '',
  ].join('').trim();

  const cls = clsx(
    'inline-flex items-center gap-1 rounded font-medium border bg-yellow-900/40 text-yellow-300 border-yellow-500/30 capitalize whitespace-nowrap',
    size === 'sm' ? 'px-2 py-0.5 text-sm' : 'px-2.5 py-1 text-base',
    onClick && 'hover:bg-yellow-900/60 cursor-pointer transition-colors',
    className,
  );

  const inner = (
    <>
      <Icon name="flag" size="xs" />
      <span className="leading-none">{label}</span>
    </>
  );

  return onClick ? (
    <button type="button" onClick={onClick} className={cls} title={tooltip}>{inner}</button>
  ) : (
    <span className={cls} title={tooltip}>{inner}</span>
  );
}
