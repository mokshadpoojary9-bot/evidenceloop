import { Check, Copy, RotateCcw, SendHorizontal, Square, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Markdown } from '../lib/markdown';
import { useVerity, type VerityMessage } from '../verity';
import { useViewer } from '../viewer';
import { Button, Textarea } from './ui';
import { VerityOrb } from './VerityOrb';

export const VERITY_FOOTNOTE = 'Verity can make mistakes — check the evidence.';

function suggestions(role: 'technician' | 'reviewer' | undefined, onWorkOrder: boolean): string[] {
  if (role === 'reviewer') {
    return [
      ...(onWorkOrder ? ['Summarize this work order for my decision'] : []),
      "What's waiting in my review queue?",
      'Which work orders are contradicted, and why?',
      "Summarize today's activity",
      'How does reviewer sign-off work?',
    ];
  }
  return [
    ...(onWorkOrder ? ['Why is this work order not verified?'] : []),
    'What evidence is missing?',
    'What should I upload next?',
    "Summarize today's activity",
    'How does EvidenceLoop work?',
  ];
}

/**
 * The chat with Verity: a slide-over on the right (full screen on phones), built on <dialog>
 * so focus stays inside and Escape closes it. Loaded only when first opened.
 */
export function VerityPanel() {
  const { isOpen, close, messages, busy, ask, stop, reset, workOrderId } = useVerity();
  const { viewer } = useViewer();
  const dialog = useRef<HTMLDialogElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (isOpen && !element.open) {
      element.showModal();
      input.current?.focus();
    }
    if (!isOpen && element.open) element.close();
  }, [isOpen]);

  const last = messages.at(-1);
  useEffect(() => end.current?.scrollIntoView?.({ block: 'end' }), [messages.length, last?.content]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!draft.trim() || busy) return;
    ask(draft);
    setDraft('');
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="verity-title"
      onClose={close}
      onClick={(event) => event.target === dialog.current && close()}
      className="m-0 ml-auto h-dvh max-h-none w-full max-w-none border-l border-line bg-surface p-0 text-fg-muted shadow-raised backdrop:bg-black/50 sm:w-[26rem]"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <VerityOrb size="lg" />
          <div className="min-w-0 flex-1">
            <h2 id="verity-title" className="font-semibold text-fg">
              Verity
            </h2>
            <p className="text-xs text-verity-fg">Your verification co-pilot</p>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="icon" onClick={reset} aria-label="New conversation" title="New conversation">
              <RotateCcw className="size-4" aria-hidden />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={close} aria-label="Close Verity">
            <X className="size-5" aria-hidden />
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite" aria-busy={busy}>
          {messages.length === 0 ? (
            <div className="space-y-4">
              <p className="text-sm">
                I answer from your own work orders: requirements, evidence, observations, open requests and the audit
                trail. I can't change anything, and I won't guess what the evidence doesn't show.
              </p>
              <ul className="flex flex-wrap gap-2" aria-label="Suggested questions">
                {suggestions(viewer?.role, workOrderId !== null).map((question) => (
                  <li key={question}>
                    <button
                      type="button"
                      onClick={() => ask(question)}
                      className="rounded-full border border-verity/40 bg-verity/10 px-3 py-1.5 text-left text-xs font-semibold text-verity-fg transition-colors hover:border-verity hover:bg-verity/15"
                    >
                      {question}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            messages.map((message) => <Message key={message.id} message={message} />)
          )}
          <div ref={end} />
        </div>

        <form onSubmit={submit} className="space-y-2 border-t border-line px-4 py-3">
          <div className="flex items-end gap-2">
            <Textarea
              ref={input}
              rows={2}
              value={draft}
              maxLength={2000}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) submit(event);
              }}
              placeholder="Ask about your work orders…"
              aria-label="Ask Verity"
              className="min-h-0 flex-1 resize-none text-sm"
            />
            {busy ? (
              <Button variant="secondary" size="icon" onClick={stop} aria-label="Stop answering">
                <Square className="size-4 fill-current" aria-hidden />
              </Button>
            ) : (
              <Button type="submit" variant="primary" size="icon" disabled={!draft.trim()} aria-label="Send">
                <SendHorizontal className="size-4" aria-hidden />
              </Button>
            )}
          </div>
          <p className="text-[11px] text-fg-faint">{VERITY_FOOTNOTE} Nemotron Nano on Nebius · read-only.</p>
        </form>
      </div>
    </dialog>
  );
}

function Message({ message }: { message: VerityMessage }) {
  const [copied, setCopied] = useState(false);
  if (message.role === 'user') {
    return (
      <div className="ml-8 rounded-2xl rounded-br-md bg-surface-3 px-3 py-2 text-sm text-fg">
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    );
  }
  const copy = () => {
    void navigator.clipboard?.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="flex gap-2.5">
      <span className="mt-1">
        <VerityOrb size="sm" />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5 text-sm text-fg-muted">
        {message.pending && !message.content ? (
          <p role="status" className="flex items-center gap-1 py-1" aria-label="Verity is typing">
            {[0, 1, 2].map((dot) => (
              <span key={dot} className="size-1.5 animate-pulse rounded-full bg-verity" style={{ animationDelay: `${dot * 150}ms` }} />
            ))}
          </p>
        ) : (
          message.content && <Markdown text={message.content} />
        )}
        {message.error && (
          <p role="alert" className="rounded-lg border border-contradicted/40 bg-contradicted/10 px-2.5 py-1.5 text-xs text-contradicted-fg">
            {message.error}
          </p>
        )}
        {!message.pending && message.content && !message.error && (
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 text-[11px] text-fg-faint hover:text-fg"
            aria-label="Copy answer"
          >
            {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
    </div>
  );
}
