import { FileWarning, ImageOff, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { fileUrl } from '../api';
import { useEvidenceUpload, type UploadState } from '../hooks';
import { EVIDENCE_KINDS, EVIDENCE_KIND_LABELS, type EvidenceKind, type WorkOrderDetail } from '../types';
import { useViewer } from '../viewer';
import { EVIDENCE_ACCEPT, EVIDENCE_ICON, formatBytes, formatRelative } from './labels';
import { Button, DropZone, Input, ProgressBar, Select } from './ui';

type Item = WorkOrderDetail['evidence'][number];

interface Props {
  workOrderId: string;
  /** Owner of the work order: the technician who uploads its evidence. */
  ownerId: string;
  evidence: Item[];
  maxUploadMb: number | null;
  /** When set, the upload form is replaced by this explanation. */
  readOnlyReason: string | null;
  onUploaded: () => void;
  /** Opens the evidence viewer. */
  onOpen: (evidenceId: string) => void;
}

/** The evidence gallery, and the drag-and-drop upload form. */
export function EvidencePanel({
  workOrderId,
  ownerId,
  evidence,
  maxUploadMb,
  readOnlyReason,
  onUploaded,
  onOpen,
}: Props) {
  const { viewer } = useViewer();
  const uploader = (item: Item) =>
    item.uploadedBy === viewer?.id ? 'You' : item.uploadedBy === ownerId ? 'Technician' : 'Another user';

  return (
    <section aria-labelledby="evidence-heading" className="card p-4">
      <h2 id="evidence-heading" className="eyebrow">
        Evidence ({evidence.length})
      </h2>

      {evidence.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-line p-4 text-center text-sm text-fg-subtle">
          Nothing uploaded yet. Nothing can be proven without evidence.
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-2">
          {evidence.map((item) => (
            <li key={item.id}>
              <Thumbnail item={item} uploader={uploader(item)} onOpen={() => onOpen(item.id)} />
            </li>
          ))}
        </ul>
      )}

      {readOnlyReason ? (
        <p className="mt-4 border-t border-line pt-4 text-sm text-fg-subtle">{readOnlyReason} Uploads are disabled.</p>
      ) : (
        <UploadForm workOrderId={workOrderId} maxUploadMb={maxUploadMb} onUploaded={onUploaded} />
      )}
    </section>
  );
}

function Thumbnail({ item, uploader, onOpen }: { item: Item; uploader: string; onOpen: () => void }) {
  const Icon = EVIDENCE_ICON[item.kind];
  const url = fileUrl(item.url);
  const [broken, setBroken] = useState(false);
  const notReadable = item.mimeType.startsWith('audio/') || item.pdf?.textLayer === false;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-full overflow-hidden rounded-xl border border-line bg-surface-2 text-left transition-colors hover:border-line-strong focus-visible:border-accent"
      aria-label={`View ${EVIDENCE_KIND_LABELS[item.kind]} ${item.fileName}`}
    >
      <span className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-surface-3">
        {url && !broken && item.mimeType.startsWith('image/') ? (
          <img
            src={url}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            className="size-full object-cover transition-transform group-hover:scale-105"
          />
        ) : url && !broken && item.mimeType.startsWith('video/') ? (
          <video
            src={`${url}#t=0.5`}
            muted
            preload="metadata"
            onError={() => setBroken(true)}
            className="pointer-events-none size-full object-cover"
            aria-hidden
            tabIndex={-1}
          />
        ) : broken ? (
          <ImageOff className="size-6 text-fg-faint" aria-hidden />
        ) : (
          <Icon className="size-7 text-fg-faint" aria-hidden />
        )}
        <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-ink-950/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          <Icon className="size-3" aria-hidden /> {EVIDENCE_KIND_LABELS[item.kind]}
        </span>
        {notReadable && (
          <span className="absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded-md bg-uncertain px-1.5 py-0.5 text-[10px] font-bold text-ink-950">
            <FileWarning className="size-3" aria-hidden /> Not inspected
          </span>
        )}
      </span>
      <span className="block space-y-0.5 p-2">
        <span className="block truncate text-xs font-semibold text-fg">{item.fileName}</span>
        <span className="block truncate text-[11px] text-fg-subtle">
          {uploader} · <time dateTime={item.createdAt}>{formatRelative(item.createdAt)}</time>
        </span>
        <span className="block truncate font-mono text-[10px] text-fg-faint" title={`SHA-256 ${item.sha256}`}>
          {item.sha256.slice(0, 12)} · {formatBytes(item.sizeBytes)}
        </span>
      </span>
    </button>
  );
}

interface FormProps {
  workOrderId: string;
  maxUploadMb: number | null;
  onUploaded: () => void;
}

/** Evidence the agent asked for is uploaded from its request; anything else goes here. */
function UploadForm({ workOrderId, maxUploadMb, onUploaded }: FormProps) {
  const [kind, setKind] = useState<EvidenceKind>('before_photo');
  const [note, setNote] = useState('');
  const [rejected, setRejected] = useState<string | null>(null);
  const { state, start, retry, reset } = useEvidenceUpload(workOrderId, onUploaded);
  const busy = state.phase === 'uploading';

  const send = async (file: File) => {
    const problem = checkFile(file, kind, maxUploadMb);
    setRejected(problem);
    if (problem) return;
    if (await start({ file, kind, note, requestId: null })) setNote('');
  };

  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      <label className="block text-sm">
        <span className="mb-1 block font-semibold">Evidence type</span>
        <Select
          value={kind}
          disabled={busy}
          onChange={(event) => {
            setKind(event.target.value as EvidenceKind);
            setRejected(null);
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
        <span className="mb-1 block font-semibold">
          Note <span className="font-normal text-fg-faint">(optional)</span>
        </span>
        <Input
          value={note}
          maxLength={1000}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Context for a reviewer — a claim, not proof"
        />
      </label>

      <DropZone
        accept={EVIDENCE_ACCEPT[kind]}
        disabled={busy}
        onFile={(file) => void send(file)}
        title={`Drop a ${EVIDENCE_KIND_LABELS[kind].toLowerCase()} here, or choose a file`}
        hint={maxUploadMb !== null ? `Up to ${maxUploadMb} MB. The SHA-256 hash is recorded on upload.` : undefined}
      />

      {rejected && (
        <p role="alert" className="text-xs text-contradicted-fg">
          {rejected}
        </p>
      )}
      <UploadStatus state={state} onRetry={() => void retry()} onDismiss={reset} />
    </div>
  );
}

/** Progress while uploading; the outcome afterwards, with a retry when it failed. */
export function UploadStatus({ state, onRetry, onDismiss }: { state: UploadState; onRetry: () => void; onDismiss: () => void }) {
  if (state.phase === 'idle') return null;
  if (state.phase === 'uploading') {
    return (
      <div role="status" className="space-y-1 text-xs text-fg-muted">
        <p className="flex justify-between gap-2">
          <span className="truncate">
            {/* Every byte sent: the server is storing and checking the file. */}
            {state.progress >= 1 ? `Saving ${state.fileName} on the server…` : `Uploading ${state.fileName}…`}
          </span>
          <span className="tabular-nums">{Math.round(state.progress * 100)}%</span>
        </p>
        <ProgressBar value={state.progress} label={`Uploading ${state.fileName}`} />
      </div>
    );
  }
  if (state.phase === 'failed') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-contradicted/40 bg-contradicted/10 p-2 text-xs text-contradicted-fg">
        <p className="min-w-0 flex-1 break-words">
          Upload of {state.fileName} failed: {state.error}
        </p>
        <Button size="sm" onClick={onRetry}>
          <RotateCcw className="size-3.5" aria-hidden /> Retry
        </Button>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-contradicted-fg/80 hover:text-contradicted-fg">
          <X className="size-4" aria-hidden />
        </button>
      </div>
    );
  }
  return (
    <p role="status" className="text-xs text-fg-muted">
      Uploaded {state.fileName}. {state.message}
    </p>
  );
}

/** Client-side checks the backend also enforces, so the user hears about them before uploading. */
export function checkFile(file: File, kind: EvidenceKind, maxUploadMb: number | null): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  if (maxUploadMb !== null && file.size > maxUploadMb * 1024 * 1024) {
    return `${file.name} is larger than the ${maxUploadMb} MB limit.`;
  }
  const accepted = EVIDENCE_ACCEPT[kind].split(',');
  const type = file.type || 'unknown type';
  const ok = accepted.some((pattern) => (pattern.endsWith('/*') ? type.startsWith(pattern.slice(0, -1)) : type === pattern));
  return ok ? null : `A ${EVIDENCE_KIND_LABELS[kind].toLowerCase()} must be ${EVIDENCE_ACCEPT[kind]} (this file is ${type}).`;
}
