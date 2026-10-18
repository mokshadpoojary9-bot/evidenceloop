import { ChevronLeft, ChevronRight, Clock, Copy, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fileUrl } from '../api';
import { describeInspection } from '../lib/inspection';
import { EVIDENCE_KIND_LABELS, type AiMode, type Observation, type WorkOrderDetail } from '../types';
import { NotInspectedLabel, PdfPreview, VideoWithMarkers, ZoomableImage } from './EvidenceMedia';
import { Button, Modal } from './ui';
import { formatBytes, formatDate, formatSeconds, REQUIREMENT_STATUS } from './labels';
import { StatusBadge } from './StatusBadge';

export interface ViewTarget {
  evidenceId: string;
  /** Start playback here (video/audio observations). */
  atSec?: number | null;
}

interface Props {
  detail: WorkOrderDetail;
  aiMode: AiMode | null;
  target: ViewTarget | null;
  onNavigate: (target: ViewTarget) => void;
  onClose: () => void;
}

/** Shows one evidence file with its metadata, what the AI could inspect, and every observation citing it. */
export function EvidenceViewer({ detail, aiMode, target, onNavigate, onClose }: Props) {
  const { evidence, requirements, requests } = detail;
  const index = target ? evidence.findIndex((item) => item.id === target.evidenceId) : -1;
  const item = index >= 0 ? evidence[index] : undefined;

  return (
    <Modal open={item !== undefined} title={item ? item.fileName : 'Evidence'} onClose={onClose} size="xl">
      {item && (
        <ViewerBody
          key={item.id}
          item={item}
          atSec={target?.atSec ?? null}
          aiMode={aiMode}
          observations={requirements.flatMap((requirement) =>
            (requirement.assessment?.observations ?? [])
              .filter((observation) => observation.evidenceId === item.id)
              .map((observation) => ({ observation, requirement })),
          )}
          request={requests.find((request) => request.id === item.requestId)}
          position={{ index, total: evidence.length }}
          onStep={(step) => onNavigate({ evidenceId: evidence[(index + step + evidence.length) % evidence.length]!.id })}
        />
      )}
    </Modal>
  );
}

type Item = WorkOrderDetail['evidence'][number];
type Requirement = WorkOrderDetail['requirements'][number];

interface BodyProps {
  item: Item;
  atSec: number | null;
  aiMode: AiMode | null;
  observations: { observation: Observation; requirement: Requirement }[];
  request: WorkOrderDetail['requests'][number] | undefined;
  position: { index: number; total: number };
  onStep: (step: 1 | -1) => void;
}

function ViewerBody({ item, atSec, aiMode, observations, request, position, onStep }: BodyProps) {
  const url = fileUrl(item.url);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const inspection = describeInspection(item, aiMode);
  const [copied, setCopied] = useState(false);
  // Shown over the preview itself: the AI never reads these, whatever the provider.
  const notInspected = item.mimeType.startsWith('audio/')
    ? 'audio is not transcribed, so the AI cannot hear this recording.'
    : item.pdf?.textLayer === false
      ? 'this PDF has no text layer (likely a scan) and OCR is not available, so the AI cannot read it.'
      : null;

  const seek = (seconds: number) => {
    if (!media.current) return;
    media.current.currentTime = seconds;
    void media.current.play().catch(() => undefined);
  };

  useEffect(() => {
    if (atSec === null || !media.current) return;
    const element = media.current;
    const jump = () => {
      element.currentTime = atSec;
    };
    if (element.readyState >= 1) jump();
    else element.addEventListener('loadedmetadata', jump, { once: true });
    return () => element.removeEventListener('loadedmetadata', jump);
  }, [atSec]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-2">
        <div className="flex min-h-64 flex-col items-center justify-center overflow-hidden rounded-xl border border-line bg-field">
          {notInspected && <NotInspectedLabel reason={notInspected} />}
          {!url ? (
            <p className="p-6 text-sm text-fg-subtle">This file cannot be displayed (no URL available).</p>
          ) : item.mimeType.startsWith('image/') ? (
            <ZoomableImage src={url} alt={`${EVIDENCE_KIND_LABELS[item.kind]}: ${item.fileName}`} />
          ) : item.mimeType.startsWith('video/') ? (
            <VideoWithMarkers
              src={url}
              videoRef={media}
              markers={observations
                .filter(({ observation }) => observation.startSec !== null)
                .map(({ observation, requirement }) => ({
                  startSec: observation.startSec!,
                  endSec: observation.endSec,
                  label: `#${requirement.position} ${requirement.title}: ${observation.text}`,
                  color: REQUIREMENT_STATUS[requirement.status].hex,
                }))}
            />
          ) : item.mimeType.startsWith('audio/') ? (
            <audio ref={media} src={url} controls preload="metadata" className="w-full p-6" />
          ) : item.mimeType === 'application/pdf' ? (
            <PdfPreview src={url} title={item.fileName} pages={item.pdf?.pages ?? null} />
          ) : item.mimeType.startsWith('text/') ? (
            <TextPreview url={url} />
          ) : (
            <p className="p-6 text-sm text-fg-subtle">No preview for {item.mimeType}.</p>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-fg-subtle">
          <Button size="sm" onClick={() => onStep(-1)} disabled={position.total < 2}>
            <ChevronLeft className="size-3.5" aria-hidden /> Previous
          </Button>
          <span>
            {position.index + 1} of {position.total}
          </span>
          <Button size="sm" onClick={() => onStep(1)} disabled={position.total < 2}>
            Next <ChevronRight className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <aside className="space-y-4 text-sm">
        <section>
          <h3 className="eyebrow mb-1.5">File</h3>
          <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
            <dt className="text-fg-faint">Type</dt>
            <dd>{EVIDENCE_KIND_LABELS[item.kind]}</dd>
            <dt className="text-fg-faint">Format</dt>
            <dd>
              {item.mimeType} · {formatBytes(item.sizeBytes)}
            </dd>
            <dt className="text-fg-faint">Uploaded</dt>
            <dd>{formatDate(item.createdAt)}</dd>
            <dt className="text-fg-faint">SHA-256</dt>
            <dd className="flex items-start gap-1">
              <code className="font-mono text-[10px] break-all text-fg-muted">{item.sha256}</code>
              <button
                className="shrink-0 text-fg-subtle hover:text-fg"
                aria-label="Copy SHA-256"
                onClick={() =>
                  void navigator.clipboard?.writeText(item.sha256).then(
                    () => setCopied(true),
                    () => undefined,
                  )
                }
              >
                <Copy className="size-3.5" aria-hidden />
              </button>
              {copied && <span className="text-[10px] text-proven-fg">copied</span>}
            </dd>
          </dl>
          {item.note && (
            <p className="mt-2 text-xs text-fg-subtle">
              <span className="font-semibold text-fg-muted">Uploader’s note</span> (a claim, not proof): “{item.note}”
            </p>
          )}
          {request && <p className="mt-2 text-xs text-fg-subtle">Answers the request: {request.instruction}</p>}
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-accent-fg hover:underline">
              <ExternalLink className="size-3" aria-hidden /> Open original
            </a>
          )}
        </section>

        <section>
          <h3 className="eyebrow mb-1.5">What the AI can inspect</h3>
          <p
            className={`flex gap-1.5 text-xs ${
              inspection.tone === 'ok' ? 'text-proven-fg' : inspection.tone === 'partial' ? 'text-uncertain-fg' : 'text-contradicted-fg'
            }`}
          >
            {inspection.tone === 'none' ? (
              <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            ) : (
              <Eye className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            )}
            {inspection.summary}
          </p>
          {inspection.notInspected && (
            <p className="mt-1 text-xs text-fg-subtle">
              <span className="font-semibold text-fg-muted">Not inspected:</span> {inspection.notInspected}
            </p>
          )}
        </section>

        <section>
          <h3 className="eyebrow mb-1.5">Observations citing this file ({observations.length})</h3>
          {observations.length === 0 ? (
            <p className="text-xs text-fg-subtle">No current assessment cites this file.</p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {observations.map(({ observation, requirement }, i) => (
                <li key={i} className="rounded-lg border border-line bg-surface-2 p-2 text-xs">
                  <p className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-fg">
                      {requirement.position}. {requirement.title}
                    </span>
                    <StatusBadge meta={REQUIREMENT_STATUS[requirement.status]} />
                  </p>
                  <p className="text-fg-muted">
                    <span
                      className={`mr-1 rounded px-1 text-[10px] font-bold uppercase ${
                        observation.kind === 'direct' ? 'bg-proven/15 text-proven-fg' : 'bg-review/15 text-review-fg'
                      }`}
                    >
                      {observation.kind}
                    </span>
                    {observation.text}
                  </p>
                  {observation.startSec !== null && (
                    <button
                      className="mt-1 inline-flex items-center gap-1 text-accent-fg hover:underline disabled:text-fg-faint disabled:no-underline"
                      onClick={() => seek(observation.startSec!)}
                      disabled={!item.mimeType.startsWith('video/') && !item.mimeType.startsWith('audio/')}
                    >
                      <Clock className="size-3" aria-hidden />
                      {formatSeconds(observation.startSec)}
                      {observation.endSec !== null && `–${formatSeconds(observation.endSec)}`}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}

const MAX_PREVIEW_CHARS = 100_000;

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
      .then(
        (value) => !cancelled && setText(value),
        () => !cancelled && setError(true),
      );
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (error) return <p className="p-6 text-sm text-contradicted-fg">Could not load the file.</p>;
  if (text === null) return <p className="p-6 text-sm text-fg-subtle">Loading…</p>;
  return (
    <pre className="max-h-[65vh] w-full overflow-auto p-4 font-mono text-xs whitespace-pre-wrap text-fg">
      {text.slice(0, MAX_PREVIEW_CHARS)}
      {text.length > MAX_PREVIEW_CHARS && '\n… (preview truncated)'}
    </pre>
  );
}
