import { AnimatePresence, motion } from 'framer-motion';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type Kind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const NOOP: ToastApi = { success: () => {}, error: () => {}, info: () => {} };
const DURATION: Record<Kind, number> = { success: 4500, info: 4500, error: 8000 };
const ICON = { success: CircleCheck, error: CircleAlert, info: Info };
const TONE: Record<Kind, string> = {
  success: 'text-proven-fg',
  error: 'text-contradicted-fg',
  info: 'text-analyzing-fg',
};

/** Feedback for actions. Outside a provider (e.g. in isolated tests) toasts are dropped. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const next = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (kind: Kind, message: string) => {
      const id = ++next.current;
      setToasts((list) => [...list.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), DURATION[kind]);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Polite for confirmations; each error is also an alert. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-96"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const Icon = ICON[toast.kind];
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.98 }}
                transition={{ duration: 0.18 }}
                role={toast.kind === 'error' ? 'alert' : 'status'}
                className="card pointer-events-auto flex w-full items-start gap-2.5 bg-surface px-3.5 py-3 text-sm text-fg shadow-raised"
              >
                <Icon className={`mt-0.5 size-4 shrink-0 ${TONE[toast.kind]}`} aria-hidden />
                <p className="min-w-0 flex-1 break-words">{toast.message}</p>
                <button
                  type="button"
                  className="-m-1 rounded-md p-1 text-fg-faint hover:text-fg"
                  onClick={() => dismiss(toast.id)}
                  aria-label="Dismiss notification"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
