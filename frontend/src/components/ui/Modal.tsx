import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Wider layout for viewers. */
  size?: 'md' | 'xl';
}

/** Modal built on the native <dialog> element: focus trapping and Escape come for free. */
export function Modal({ open, title, onClose, children, size = 'md' }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

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
      aria-labelledby={titleId}
      className={`card m-auto w-[calc(100%-2rem)] bg-surface p-0 text-fg-muted shadow-raised backdrop:bg-black/70 ${size === 'xl' ? 'max-w-5xl' : 'max-w-lg'}`}
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 id={titleId} className="min-w-0 text-lg font-bold break-words text-fg">
              {title}
            </h2>
            <Button size="icon" className="shrink-0" onClick={onClose} aria-label="Close">
              <X className="size-4" aria-hidden />
            </Button>
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
    <Modal open={open} title={title} onClose={onCancel}>
      <div className="space-y-4 text-sm text-fg-muted">
        {message}
        {error && (
          <p role="alert" className="text-contradicted-fg">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
