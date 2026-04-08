import { clsx } from 'clsx';
import { Icon } from './Icon';

export function ErrorState({
  message = 'Something went wrong',
  retry,
  className,
}: {
  message?: string;
  retry?: () => void;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col items-center gap-3 py-16 text-center', className)}>
      <Icon name="error" size="xl" className="text-error" />
      <p className="text-sm text-text-secondary">{message}</p>
      {retry && (
        <button
          onClick={retry}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent-subtle transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
}
