import { FileText, FlaskConical, LoaderCircle, Sparkles, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../api';
import type { AddRequirementsInput, RequirementDraftResponse } from '../types';
import { draftKey, RequirementEditor, type DraftRequirement } from './RequirementEditor';
import { Button, FileInput, useToast } from './ui';

interface Props {
  /** What the work order is about, to focus the proposals. */
  context: { title: string; description: string; location: string };
  aiAvailable: boolean;
  maxUploadMb: number | null;
  confirmLabel: (count: number) => string;
  /** Called with the reviewed proposals. Nothing is saved before this. */
  onConfirm: (requirements: DraftRequirement[], source: AddRequirementsInput['source']) => Promise<void>;
}

/**
 * Upload an SOP/manual → "Generate requirements" → review, edit and delete the
 * proposals → confirm. Proposals are only kept in the browser until confirmed.
 */
export function SopDraftPanel({ context, aiAvailable, maxUploadMb, confirmLabel, onConfirm }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'drafting' | 'saving' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ response: RequirementDraftResponse; items: DraftRequirement[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const tooLarge = file !== null && maxUploadMb !== null && file.size > maxUploadMb * 1024 * 1024;

  const toast = useToast();
  const generate = async () => {
    if (!file) return;
    setBusy('drafting');
    setError(null);
    try {
      const response = await api.draftRequirements(file, context);
      setDraft({
        response,
        items: response.proposals.map(({ sourceQuote, ...proposal }) => ({ key: draftKey(), ...proposal, sourceQuote })),
      });
      toast.info(`${response.proposals.length} requirement${response.proposals.length === 1 ? '' : 's'} proposed. Review them before saving.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not draft requirements';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const discard = () => {
    setDraft(null);
    setFile(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const confirm = async () => {
    if (!draft) return;
    setBusy('saving');
    setError(null);
    try {
      await onConfirm(draft.items, {
        kind: 'sop',
        fileName: draft.response.source.fileName,
        simulated: draft.response.simulated,
      });
      toast.success(`Saved ${draft.items.length} requirement${draft.items.length === 1 ? '' : 's'}`);
      discard();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save the requirements';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const update = (key: number, patch: Partial<DraftRequirement>) =>
    setDraft((current) =>
      current && { ...current, items: current.items.map((item) => (item.key === key ? { ...item, ...patch } : item)) },
    );

  if (!draft) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-fg-subtle">
          Upload an SOP or manual (PDF with a text layer, or plain text) and EvidenceLoop will propose requirements
          from it. You review and edit them; nothing is saved until you confirm.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <FileInput
            ref={fileInput}
            accept="application/pdf,text/plain,text/markdown"
            aria-label="SOP or manual file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="min-w-0 flex-1 basis-60"
          />
          <Button
            type="button"
            variant="primary"
            onClick={() => void generate()}
            disabled={!file || tooLarge || busy !== null || !aiAvailable}
            title={aiAvailable ? undefined : 'Production AI is not configured'}
          >
            {busy === 'drafting' ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            {busy === 'drafting' ? 'Reading the SOP…' : 'Generate requirements'}
          </Button>
        </div>
        {tooLarge && <p className="text-xs text-contradicted-fg">Larger than the {maxUploadMb} MB limit.</p>}
        {!aiAvailable && (
          <p className="text-xs text-uncertain-fg">Production AI is not configured, so requirements cannot be drafted.</p>
        )}
        {error && <p role="alert" className="text-sm text-contradicted-fg">{error}</p>}
      </div>
    );
  }

  const { response, items } = draft;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="flex items-center gap-1.5 text-fg-muted">
          <FileText className="size-4 text-fg-faint" aria-hidden />
          {items.length} proposal{items.length === 1 ? '' : 's'} from <strong>{response.source.fileName}</strong>
          {response.source.pages !== null && <span className="text-fg-faint">({response.source.pages} pages)</span>}
        </p>
        <Button type="button" size="sm" onClick={discard} disabled={busy !== null}>
          <X className="size-3.5" aria-hidden /> Discard
        </Button>
      </div>

      {response.simulated ? (
        <p className="dev-stripe flex gap-2 rounded-lg border border-dev/50 px-3 py-2 text-xs text-dev-fg">
          <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong>DEV ONLY — simulated list.</strong> The deterministic fixture copied step-like lines from the SOP.
            No AI read the document, and the evidence types are a keyword guess. Review every item.
          </span>
        </p>
      ) : (
        <p className="text-xs text-fg-subtle">
          Proposed by {response.model ?? 'the AI provider'}. Each one quotes the SOP passage it came from; check it
          says what the requirement claims.
        </p>
      )}
      {response.source.truncated && (
        <p className="text-xs text-uncertain-fg">
          The document is long: only its first {response.source.chars.toLocaleString()} characters were read. Later
          sections may contain requirements that are not listed here.
        </p>
      )}
      {response.dropped > 0 && (
        <p className="text-xs text-fg-subtle">
          {response.dropped} proposal{response.dropped === 1 ? ' was' : 's were'} discarded because the quoted text was
          not found in the SOP or was malformed.
        </p>
      )}

      {items.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-2 p-4 text-sm text-fg-subtle">
          No requirements could be drawn from this document. Add them by hand instead.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <RequirementEditor
              key={item.key}
              index={index}
              value={item}
              onChange={(patch) => update(item.key, patch)}
              onRemove={() =>
                setDraft((current) => current && { ...current, items: current.items.filter((i) => i.key !== item.key) })
              }
              removable
            />
          ))}
        </div>
      )}

      {error && <p role="alert" className="text-sm text-contradicted-fg">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={() => void confirm()}
          disabled={items.length === 0 || items.some((item) => !item.title.trim()) || busy !== null}
        >
          {busy === 'saving' && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          {confirmLabel(items.length)}
        </Button>
      </div>
    </div>
  );
}
