import { LoaderCircle, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, fileUrl } from '../api';
import {
  EVIDENCE_KINDS,
  EVIDENCE_KIND_LABELS,
  type EvidenceKind,
  type EvidenceRequest,
  type ReanalysisOutcome,
  type WorkOrderDetail,
} from '../types';
import { EVIDENCE_ACCEPT, EVIDENCE_ICON, formatBytes, formatDate } from './labels';
import { Button, FileInput, Input, Select, useToast } from './ui';

interface Props {
  workOrderId: string;
  evidence: WorkOrderDetail['evidence'];
  maxUploadMb: number | null;
  /** When set, the upload form is replaced by this explanation. */
  readOnlyReason: string | null;
  /** The evidence request being answered, if the user clicked "Upload" on one. */
  respondingTo: EvidenceRequest | null;
  onClearRequest: () => void;
  onUploaded: () => void;
  /** Opens the evidence viewer. */
  onOpen: (evidenceId: string) => void;
}

const OUTCOME_MESSAGE: Record<ReanalysisOutcome, string> = {
  started: 'Uploaded. Re-analysing the affected requirements…',
  queued: 'Uploaded. It will be included in a re-analysis as soon as the current run finishes.',
  skipped_no_prior_run: 'Uploaded. Run verification when your evidence is complete.',
  skipped_ai_not_configured: 'Uploaded. It was not analysed: production AI is not configured.',
};

export function EvidencePanel({
  workOrderId,
  evidence,
  maxUploadMb,
  readOnlyReason,
  respondingTo,
  onClearRequest,
  onUploaded,
  onOpen,
}: Props) {
  const [kind, setKind] = useState<EvidenceKind>('before_photo');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  // Answering a request fixes the kind and brings the form into view.
  useEffect(() => {
    if (!respondingTo) return;
    setKind(respondingTo.kind);
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
    form.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [respondingTo]);

  const tooLarge = file !== null && maxUploadMb !== null && file.size > maxUploadMb * 1024 * 1024;
  const toast = useToast();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || tooLarge) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.uploadEvidence(workOrderId, {
        file,
        kind,
        note,
        requestId: respondingTo?.id ?? null,
      });
      setMessage({ text: OUTCOME_MESSAGE[result.reanalysis], error: false });
      toast.success(`Uploaded ${file.name}`);
      setFile(null);
      setNote('');
      if (fileInput.current) fileInput.current.value = '';
      onClearRequest();
      onUploaded();
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Upload failed';
      setMessage({ text, error: true });
      toast.error(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="evidence-heading" className="card p-4">
      <h2 id="evidence-heading" className="eyebrow">
        Evidence ({evidence.length})
      </h2>

      {evidence.length === 0 ? (
        <p className="mt-3 text-sm text-fg-subtle">Nothing uploaded yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {evidence.map((item) => {
            const Icon = EVIDENCE_ICON[item.kind];
            const url = fileUrl(item.url);
            return (
              <li key={item.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-2">
                <button
                  type="button"
                  className="shrink-0 rounded-lg"
                  onClick={() => onOpen(item.id)}
                  aria-label={`View ${item.fileName}`}
                >
                  {url && item.mimeType.startsWith('image/') ? (
                    <img src={url} alt="" className="size-11 rounded-lg object-cover" loading="lazy" />
                  ) : (
                    <span className="flex size-11 items-center justify-center rounded-lg bg-surface-3 text-fg-subtle">
                      <Icon className="size-5" aria-hidden />
                    </span>
                  )}
                </button>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium text-fg">
                    <button type="button" className="max-w-full truncate text-left hover:underline" onClick={() => onOpen(item.id)}>
                      {item.fileName}
                    </button>
                  </p>
                  <p className="truncate text-xs text-fg-subtle">
                    {EVIDENCE_KIND_LABELS[item.kind]} · {formatBytes(item.sizeBytes)} · {formatDate(item.createdAt)}
                  </p>
                  <p className="truncate font-mono text-[10px] text-fg-faint" title={`SHA-256 ${item.sha256}`}>
                    sha256 {item.sha256.slice(0, 16)}…
                  </p>
                  {item.note && <p className="mt-0.5 text-xs text-fg-subtle italic">“{item.note}”</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {readOnlyReason ? (
        <p className="mt-4 border-t border-line pt-4 text-sm text-fg-subtle">{readOnlyReason} Uploads are disabled.</p>
      ) : (
        <form ref={form} onSubmit={handleSubmit} className="mt-4 space-y-3 border-t border-line pt-4">
          {respondingTo && (
            <div className="flex items-start gap-2 rounded-lg border border-uncertain/40 bg-uncertain/10 p-2.5 text-xs text-uncertain-fg">
              <p className="flex-1">
                <strong>Answering request:</strong> {respondingTo.instruction}
              </p>
              <button type="button" onClick={onClearRequest} aria-label="Stop answering this request">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          )}

          <label className="block text-sm">
            <span className="mb-1 block font-semibold">Evidence type</span>
            <Select
              value={kind}
              disabled={respondingTo !== null}
              onChange={(event) => {
                setKind(event.target.value as EvidenceKind);
                setFile(null);
                if (fileInput.current) fileInput.current.value = '';
              }}
            >
              {EVIDENCE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {EVIDENCE_KIND_LABELS[value]}
                </option>
              ))}
            </Select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-semibold">File</span>
            <FileInput
              ref={fileInput}
              accept={EVIDENCE_ACCEPT[kind]}
              required
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {tooLarge && <span className="mt-1 block text-xs text-contradicted-fg">Larger than the {maxUploadMb} MB limit.</span>}
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-semibold">
              Note <span className="font-normal text-fg-faint">(optional)</span>
            </span>
            <Input
              value={note}
              maxLength={1000}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Context for a reviewer — treated as a claim, not as proof"
            />
          </label>

          <Button type="submit" variant="primary" className="w-full" disabled={!file || tooLarge || busy}>
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            {busy ? 'Uploading…' : 'Upload evidence'}
          </Button>

          {message && (
            <p role="status" className={`text-xs ${message.error ? 'text-contradicted-fg' : 'text-fg-muted'}`}>
              {message.text}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
