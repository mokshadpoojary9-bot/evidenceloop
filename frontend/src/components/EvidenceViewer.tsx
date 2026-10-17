import { ChevronLeft, ChevronRight, Clock, Copy, ExternalLink, Eye, EyeOff, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fileUrl } from '../api';
import { describeInspection } from '../lib/inspection';
import { EVIDENCE_KIND_LABELS, type AiMode, type Observation, type WorkOrderDetail } from '../types';
import { Dialog } from './Dialog';
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
    <Dialog open={item !== undefined} title={item ? item.fileName : 'Evidence'} onClose={onClose} size="xl">
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
    </Dialog>
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
        <div className="flex min-h-64 items-center justify-center overflow-hidden rounded-xl border border-line bg-ink-950">
          {!url ? (
            <p className="p-6 text-sm text-slate-400">This file cannot be displayed (no URL available).</p>
          ) : item.mimeType.startsWith('image/') ? (
            <ZoomableImage src={url} alt={`${EVIDENCE_KIND_LABELS[item.kind]}: ${item.fileName}`} />
          ) : item.mimeType.startsWith('video/') ? (
            <video ref={media} src={url} controls preload="metadata" className="max-h-[65vh] w-full" />
          ) : item.mimeType.startsWith('audio/') ? (
            <audio ref={media} src={url} controls preload="metadata" className="w-full p-6" />
          ) : item.mimeType === 'application/pdf' ? (
            <iframe src={url} title={item.fileName} className="h-[65vh] w-full bg-white" />
          ) : item.mimeType.startsWith('text/') ? (
            <TextPreview url={url} />
          ) : (
            <p className="p-6 text-sm text-slate-400">No preview for {item.mimeType}.</p>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <button className="btn px-2 py-1 text-xs" onClick={() => onStep(-1)} disabled={position.total < 2}>
            <ChevronLeft className="size-3.5" aria-hidden /> Previous
          </button>
          <span>
            {position.index + 1} of {position.total}
          </span>
          <button className="btn px-2 py-1 text-xs" onClick={() => onStep(1)} disabled={position.total < 2}>
            Next <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <aside className="space-y-4 text-sm">
        <section>
          <h3 className="eyebrow mb-1.5">File</h3>
          <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
            <dt className="text-slate-500">Type</dt>
            <dd>{EVIDENCE_KIND_LABELS[item.kind]}</dd>
            <dt className="text-slate-500">Format</dt>
            <dd>
              {item.mimeType} · {formatBytes(item.sizeBytes)}
            </dd>
            <dt className="text-slate-500">Uploaded</dt>
            <dd>{formatDate(item.createdAt)}</dd>
            <dt className="text-slate-500">SHA-256</dt>
            <dd className="flex items-start gap-1">
              <code className="font-mono text-[10px] break-all text-slate-300">{item.sha256}</code>
              <button
                className="shrink-0 text-slate-400 hover:text-white"
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
              {copied && <span className="text-[10px] text-emerald-300">copied</span>}
            </dd>
          </dl>
          {item.note && (
            <p className="mt-2 text-xs text-slate-400">
              <span className="font-semibold text-slate-300">Uploader’s note</span> (a claim, not proof): “{item.note}”
            </p>
          )}
          {request && <p className="mt-2 text-xs text-slate-400">Answers the request: {request.instruction}</p>}
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline">
              <ExternalLink className="size-3" aria-hidden /> Open original
            </a>
          )}
        </section>

        <section>
          <h3 className="eyebrow mb-1.5">What the AI can inspect</h3>
          <p
            className={`flex gap-1.5 text-xs ${
              inspection.tone === 'ok' ? 'text-emerald-300' : inspection.tone === 'partial' ? 'text-amber-200' : 'text-rose-200'
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
            <p className="mt-1 text-xs text-slate-400">
              <span className="font-semibold text-slate-300">Not inspected:</span> {inspection.notInspected}
            </p>
          )}
        </section>

        <section>
          <h3 className="eyebrow mb-1.5">Observations citing this file ({observations.length})</h3>
          {observations.length === 0 ? (
            <p className="text-xs text-slate-400">No current assessment cites this file.</p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {observations.map(({ observation, requirement }, i) => (
                <li key={i} className="rounded-lg border border-line bg-ink-800 p-2 text-xs">
                  <p className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-white">
                      {requirement.position}. {requirement.title}
                    </span>
                    <StatusBadge meta={REQUIREMENT_STATUS[requirement.status]} />
                  </p>
                  <p className="text-slate-300">
                    <span
                      className={`mr-1 rounded px-1 text-[10px] font-bold uppercase ${
                        observation.kind === 'direct' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-violet-400/15 text-violet-300'
                      }`}
                    >
                      {observation.kind}
                    </span>
                    {observation.text}
                  </p>
                  {observation.startSec !== null && (
                    <button
                      className="mt-1 inline-flex items-center gap-1 text-accent hover:underline disabled:text-slate-500 disabled:no-underline"
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

function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <div className={`relative w-full ${zoomed ? 'max-h-[65vh] overflow-auto' : ''}`}>
      <img
        src={src}
        alt={alt}
        className={zoomed ? 'max-w-none' : 'mx-auto max-h-[65vh] w-auto object-contain'}
      />
      <button
        className="btn absolute top-2 right-2 px-2 py-1 text-xs"
        onClick={() => setZoomed((value) => !value)}
        aria-label={zoomed ? 'Fit to view' : 'Actual size'}
      >
        {zoomed ? <ZoomOut className="size-3.5" aria-hidden /> : <ZoomIn className="size-3.5" aria-hidden />}
      </button>
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
  if (error) return <p className="p-6 text-sm text-rose-300">Could not load the file.</p>;
  if (text === null) return <p className="p-6 text-sm text-slate-400">Loading…</p>;
  return (
    <pre className="max-h-[65vh] w-full overflow-auto p-4 font-mono text-xs whitespace-pre-wrap text-slate-200">
      {text.slice(0, MAX_PREVIEW_CHARS)}
      {text.length > MAX_PREVIEW_CHARS && '\n… (preview truncated)'}
    </pre>
  );
}
