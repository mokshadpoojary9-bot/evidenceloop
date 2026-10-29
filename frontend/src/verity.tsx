import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { askVerity, type VerityTurn } from './api';

export interface VerityMessage extends VerityTurn {
  id: number;
  /** Shown instead of (or after) the text when the answer failed. */
  error?: string;
  /** Still streaming. */
  pending?: boolean;
}

interface VerityState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  messages: VerityMessage[];
  busy: boolean;
  ask: (question: string) => void;
  stop: () => void;
  reset: () => void;
  /** The work order being viewed, sent so Verity answers about it first. */
  workOrderId: string | null;
}

const VerityContext = createContext<VerityState | null>(null);

/**
 * Verity, the read-only assistant. The conversation lives here, above the panel, so it
 * survives closing the panel and keeps streaming meanwhile. It is per signed-in user: the
 * provider is remounted when the user changes, and nothing is stored.
 */
export function VerityProvider({ workOrderId, children }: { workOrderId: string | null; children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [messages, setMessages] = useState<VerityMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(0);

  const update = (id: number, change: (message: VerityMessage) => VerityMessage) =>
    setMessages((list) => list.map((message) => (message.id === id ? change(message) : message)));

  const ask = useCallback(
    (question: string) => {
      const text = question.trim();
      if (!text || busy) return;
      const history: VerityTurn[] = [
        ...messages.filter((message) => !message.error && message.content).map(({ role, content }) => ({ role, content })),
        { role: 'user', content: text },
      ];
      const userId = nextId.current++;
      const replyId = nextId.current++;
      setMessages((list) => [...list, { id: userId, role: 'user', content: text }, { id: replyId, role: 'assistant', content: '', pending: true }]);
      setBusy(true);
      const controller = new AbortController();
      abort.current = controller;
      askVerity({ messages: history, workOrderId }, (delta) => update(replyId, (message) => ({ ...message, content: message.content + delta })), controller.signal)
        .then(
          () => update(replyId, (message) => ({ ...message, pending: false })),
          (error: unknown) => {
            const aborted = controller.signal.aborted;
            update(replyId, (message) => ({
              ...message,
              pending: false,
              error: aborted ? undefined : error instanceof Error ? error.message : 'Verity could not answer.',
              content: aborted && !message.content ? 'Stopped.' : message.content,
            }));
          },
        )
        .finally(() => {
          if (abort.current === controller) abort.current = null;
          setBusy(false);
        });
    },
    [busy, messages, workOrderId],
  );

  const stop = useCallback(() => abort.current?.abort(), []);
  const reset = useCallback(() => {
    abort.current?.abort();
    setMessages([]);
  }, []);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ isOpen, open, close, messages, busy, ask, stop, reset, workOrderId }),
    [isOpen, open, close, messages, busy, ask, stop, reset, workOrderId],
  );
  return <VerityContext.Provider value={value}>{children}</VerityContext.Provider>;
}

export function useVerity(): VerityState {
  const value = useContext(VerityContext);
  if (!value) throw new Error('useVerity must be used inside VerityProvider');
  return value;
}
