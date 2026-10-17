import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Wider layout for viewers. */
  size?: 'md' | 'xl';
}

/** Modal built on the native <dialog> element: focus trapping and Escape come for free. */
export function Dialog({ open, title, onClose, children, size = 'md' }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
      aria-labelledby="dialog-title"
      className={`card m-auto w-[calc(100%-2rem)] p-0 text-slate-200 backdrop:bg-black/70 ${size === 'xl' ? 'max-w-5xl' : 'max-w-lg'}`}
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 id="dialog-title" className="min-w-0 text-lg font-bold break-words text-white">
              {title}
            </h2>
            <button className="btn shrink-0 px-2 py-1.5" onClick={onClose} aria-label="Close">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel, danger, busy, error, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Dialog open={open} title={title} onClose={onCancel}>
      <div className="space-y-4 text-sm text-slate-300">
        {message}
        {error && <p role="alert" className="text-rose-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
