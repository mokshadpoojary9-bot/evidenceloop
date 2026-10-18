import { useId, type ComponentProps, type ReactNode } from 'react';

export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`input ${className}`} {...props} />;
}

const FILE_BUTTON =
  'file:mr-3 file:rounded-md file:border-0 file:bg-surface-3 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-fg';

/** A file picker whose button matches the rest of the kit. */
export function FileInput({ className = '', ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return <input type="file" className={`input ${FILE_BUTTON} ${className}`} {...props} />;
}

export function Textarea({ className = '', ...props }: ComponentProps<'textarea'>) {
  return <textarea className={`input ${className}`} {...props} />;
}

export function Select({ className = '', ...props }: ComponentProps<'select'>) {
  return <select className={`input ${className}`} {...props} />;
}

/**
 * A labelled form control. `children` receives the id to put on the control, so the label,
 * hint and error are all associated with it.
 */
export function Field({
  label,
  hint,
  error,
  className = '',
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`text-sm ${className}`}>
      <label htmlFor={id} className="mb-1 block font-semibold text-fg">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-fg-faint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-contradicted-fg">
          {error}
        </p>
      )}
    </div>
  );
}
