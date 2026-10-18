import { UploadCloud } from 'lucide-react';
import { forwardRef, useState, type DragEvent, type ReactNode } from 'react';

interface Props {
  accept: string;
  disabled?: boolean;
  /** Called with the dropped or picked file. */
  onFile: (file: File) => void;
  title: ReactNode;
  hint?: ReactNode;
  className?: string;
}

/**
 * Drag a file here, or press it (Enter/Space) to open the file picker. The input stays in
 * the tab order, so the zone is reachable and usable from the keyboard.
 */
export const DropZone = forwardRef<HTMLInputElement, Props>(function DropZone(
  { accept, disabled = false, onFile, title, hint, className = '' },
  ref,
) {
  const [over, setOver] = useState(false);

  const drag = (event: DragEvent, entering: boolean) => {
    event.preventDefault();
    if (!disabled) setOver(entering);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file && !disabled) onFile(file);
  };

  return (
    <label
      onDragOver={(event) => drag(event, true)}
      onDragEnter={(event) => drag(event, true)}
      onDragLeave={(event) => drag(event, false)}
      onDrop={drop}
      className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 text-center text-sm transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30 ${
        over ? 'border-accent bg-accent/10' : 'border-line-strong bg-surface-2 hover:border-accent/60'
      } ${disabled ? 'pointer-events-none opacity-50' : ''} ${className}`}
    >
      <UploadCloud className={`size-6 ${over ? 'text-accent-fg' : 'text-fg-faint'}`} aria-hidden />
      <span className="font-semibold text-fg">{title}</span>
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
      <input
        ref={ref}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
    </label>
  );
});
