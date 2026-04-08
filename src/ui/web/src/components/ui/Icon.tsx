import { clsx } from 'clsx';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const sizeClasses: Record<IconSize, string> = {
  xs: 'text-[14px] leading-none',
  sm: 'text-[16px] leading-none',
  md: 'text-[20px] leading-none',
  lg: 'text-[24px] leading-none',
  xl: 'text-[32px] leading-none',
};

export function Icon({
  name,
  size = 'sm',
  className,
  filled = false,
  weight = 300,
}: {
  name: string;
  size?: IconSize;
  className?: string;
  filled?: boolean;
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700;
}) {
  return (
    <span
      className={clsx('material-symbols-outlined select-none shrink-0', sizeClasses[size], className)}
      style={{ fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' 20` }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
