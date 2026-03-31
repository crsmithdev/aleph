import { clsx } from 'clsx';

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
      <svg className="h-8 w-8 text-error" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
      </svg>
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
