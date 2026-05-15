import { type ReactNode, useEffect, useRef } from 'react';
import { clsx } from 'clsx';

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={clsx(
        'bg-bg-secondary text-text-primary rounded-lg p-0 backdrop:bg-black/50 max-w-lg w-full'
      )}
    >
      <div className="p-4 border-b border-border-primary flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className={clsx(
            'text-text-muted hover:text-text-primary text-xl leading-none',
            'w-7 h-7 flex items-center justify-center rounded hover:bg-bg-tertiary transition-colors'
          )}
        >
          &times;
        </button>
      </div>
      <div className="p-4 overscroll-contain">{children}</div>
    </dialog>
  );
}
