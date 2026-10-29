import { motion } from 'framer-motion';
import { MessageSquareWarning, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useEvidenceUpload } from '../hooks';
import type { CaptureInfo } from '../lib/capture';
import { EVIDENCE_KIND_LABELS, type EvidenceRequest, type Requirement } from '../types';
import { CaptureButtons } from './CaptureButtons';
import { checkFile, UploadStatus } from './EvidencePanel';
import { EVIDENCE_ACCEPT, EVIDENCE_ICON, formatRelative } from './labels';
import { Button } from './ui';

interface Props {
  workOrderId: string;
  requests: EvidenceRequest[];
  requirements: Requirement[];
  maxUploadMb: number | null;
  /** False when the viewer may not upload (e.g. a reviewer); the reason is shown instead. */
  canUpload: boolean;
  readOnlyReason: string | null;
  onUploaded: () => void;
  /** Jumps to a requirement's card. */
  onSelectRequirement: (requirementId: string) => void;
}

/** The agent's open requests: the minimum additional evidence needed to settle what is unproven. */
export function EvidenceRequests({ requests, requirements, ...rest }: Props) {
  const open = requests.filter((request) => request.status === 'OPEN');
  if (open.length === 0) return null;

  return (
    <section
      aria-labelledby="requests-heading"
      className="rounded-2xl border-2 border-uncertain/50 bg-uncertain/[0.09] p-4 shadow-[0_0_0_4px] shadow-uncertain/5"
    >
      <h2 id="requests-heading" className="flex items-center gap-2 font-semibold text-uncertain-fg">
        <MessageSquareWarning className="size-5" aria-hidden />
        Additional evidence needed ({open.length})
      </h2>
      <p className="mt-1 text-xs text-fg-subtle">
        The smallest set of evidence that could settle what is not proven yet. Uploading it re-checks only the
        requirements it affects.
      </p>
      <ul className="mt-3 space-y-2">
        {open.map((request) => (
          <RequestRow key={request.id} request={request} requirements={requirements} {...rest} />
        ))}
      </ul>
    </section>
  );
}

function RequestRow({
  request,
  requirements,
  workOrderId,
  maxUploadMb,
  canUpload,
  readOnlyReason,
  onUploaded,
  onSelectRequirement,
}: Omit<Props, 'requests'> & { request: EvidenceRequest }) {
  const Icon = EVIDENCE_ICON[request.kind];
  const picker = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const { state, start, retry, reset } = useEvidenceUpload(workOrderId, onUploaded);
  const affected = requirements
    .filter((requirement) => request.requirementIds.includes(requirement.id))
    .sort((a, b) => a.position - b.position);

  const send = (file: File, capture: CaptureInfo | null = null) => {
    const problem = checkFile(file, request.kind, maxUploadMb);
    setRejected(problem);
    if (!problem) void start({ file, kind: request.kind, note: '', requestId: request.id, capture });
  };
  // The camera can answer photo and video requests; documents and audio are uploaded as files.
  const accept = EVIDENCE_ACCEPT[request.kind];
  const captureModes = accept === 'image/*' ? (['photo'] as const) : accept === 'video/*' ? (['video'] as const) : [];

  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-2 rounded-xl border border-uncertain/30 bg-surface p-3"
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-uncertain/15">
          <Icon className="size-5 text-uncertain-fg" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="font-semibold text-fg">{request.instruction}</p>
          <p className="mt-0.5 text-xs text-fg-subtle">
            {request.requestedBy === 'agent' ? 'Requested by the agent' : 'Requested by a reviewer'} ·{' '}
            {EVIDENCE_KIND_LABELS[request.kind]} · {formatRelative(request.createdAt)}
          </p>
        </div>
        {canUpload ? (
          <>
            <span className="flex flex-wrap gap-2">
              <CaptureButtons
                modes={[...captureModes]}
                disabled={state.phase === 'uploading'}
                label={{ photo: EVIDENCE_KIND_LABELS[request.kind].toLowerCase(), video: 'video' }}
                onCaptured={send}
                onUploadInstead={() => picker.current?.click()}
              />
              <Button variant="primary" onClick={() => picker.current?.click()} disabled={state.phase === 'uploading'}>
                <Upload className="size-4" aria-hidden /> Upload {EVIDENCE_KIND_LABELS[request.kind].toLowerCase()}
              </Button>
            </span>
            <input
              ref={picker}
              type="file"
              accept={EVIDENCE_ACCEPT[request.kind]}
              className="hidden"
              aria-label={`File for: ${request.instruction}`}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) send(file);
              }}
            />
          </>
        ) : (
          readOnlyReason && <p className="basis-full text-xs text-fg-faint">{readOnlyReason}</p>
        )}
      </div>

      {affected.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-fg-faint">Affects</span>
          {affected.map((requirement) => (
            <button
              key={requirement.id}
              type="button"
              onClick={() => onSelectRequirement(requirement.id)}
              className="rounded-md border border-line bg-surface-2 px-2 py-0.5 text-fg-muted hover:border-line-strong hover:text-fg"
            >
              #{requirement.position} {requirement.title}
            </button>
          ))}
        </div>
      )}

      {rejected && (
        <p role="alert" className="text-xs text-contradicted-fg">
          {rejected}
        </p>
      )}
      <UploadStatus state={state} onRetry={() => void retry()} onDismiss={reset} />
    </motion.li>
  );
}
