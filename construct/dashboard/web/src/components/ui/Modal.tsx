import { type ReactNode, useEffect, useRef } from 'react';

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
      className="bg-gray-900 text-gray-100 rounded-lg p-0 backdrop:bg-black/50 max-w-lg w-full"
    >
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-200 text-xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-gray-800 transition-colors"
        >
          &times;
        </button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}
