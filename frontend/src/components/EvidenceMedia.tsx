import { ChevronLeft, ChevronRight, EyeOff, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { formatSeconds } from './labels';
import { Button } from './ui';

// The media previews inside the evidence viewer.

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const PAN_STEP = 40;

/** An image with zoom (buttons, wheel, +/−/0 keys) and pan (drag or arrow keys while zoomed). */
export function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const zoomTo = (next: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100));
    setZoom(clamped);
    if (clamped === 1) setOffset({ x: 0, y: 0 });
  };
  const pan = (dx: number, dy: number) => setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));

  // Wheel zoom needs a non-passive listener so the dialog does not scroll at the same time.
  const stage = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const current = zoomRef.current;
      if (current === 1 && event.deltaY > 0) return; // let the page scroll past an unzoomed image
      event.preventDefault();
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      setZoom(Math.round(next * 100) / 100);
      if (next === 1) setOffset({ x: 0, y: 0 });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);
  const onPointerDown = (event: PointerEvent) => {
    if (zoom === 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (event: PointerEvent) => {
    const start = drag.current;
    if (start) setOffset({ x: start.ox + event.clientX - start.x, y: start.oy + event.clientY - start.y });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      '+': () => zoomTo(zoom * 1.25),
      '=': () => zoomTo(zoom * 1.25),
      '-': () => zoomTo(zoom / 1.25),
      '0': () => zoomTo(1),
      ArrowLeft: () => pan(PAN_STEP, 0),
      ArrowRight: () => pan(-PAN_STEP, 0),
      ArrowUp: () => pan(0, PAN_STEP),
      ArrowDown: () => pan(0, -PAN_STEP),
    };
    const action = keys[event.key];
    if (!action || (event.key.startsWith('Arrow') && zoom === 1)) return;
    event.preventDefault();
    action();
  };

  return (
    <div className="relative w-full">
      <div
        ref={stage}
        tabIndex={0}
        role="group"
        aria-label={`${alt}. Zoom ${Math.round(zoom * 100)}%. Use plus and minus to zoom, arrow keys to pan.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onKeyDown}
        onDoubleClick={() => zoomTo(zoom === 1 ? 2.5 : 1)}
        className={`flex h-[min(65vh,36rem)] touch-none items-center justify-center overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-accent ${
          zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
        }`}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-full max-w-full object-contain transition-transform duration-75"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
        />
      </div>
      <div className="absolute top-2 right-2 flex gap-1">
        <Button size="icon" onClick={() => zoomTo(zoom / 1.25)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out">
          <ZoomOut className="size-4" aria-hidden />
        </Button>
        <span className="flex min-w-12 items-center justify-center rounded-lg bg-ink-950/70 px-1.5 text-xs font-semibold text-white tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button size="icon" onClick={() => zoomTo(zoom * 1.25)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">
          <ZoomIn className="size-4" aria-hidden />
        </Button>
        <Button size="icon" onClick={() => zoomTo(1)} disabled={zoom === 1} aria-label="Fit to view">
          <Maximize2 className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

export interface TimelineMarker {
  startSec: number;
  endSec: number | null;
  label: string;
  color: string;
}

/** A video with the observations that cite it marked on a timeline under the player. */
export function VideoWithMarkers({
  src,
  markers,
  videoRef,
}: {
  src: string;
  markers: TimelineMarker[];
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const [duration, setDuration] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onMeta = () => setDuration(Number.isFinite(video.duration) ? video.duration : null);
    const onTime = () => setCurrent(video.currentTime);
    if (video.readyState >= 1) onMeta();
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('durationchange', onMeta);
    video.addEventListener('timeupdate', onTime);
    return () => {
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('durationchange', onMeta);
      video.removeEventListener('timeupdate', onTime);
    };
  }, [videoRef]);

  const seek = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    void video.play().catch(() => undefined);
  };
  const percent = (seconds: number) => (duration ? Math.min(100, (seconds / duration) * 100) : 0);

  return (
    <div className="w-full">
      <video ref={videoRef} src={src} controls preload="metadata" className="max-h-[60vh] w-full bg-black" />
      {markers.length > 0 && (
        <div className="px-3 pt-3 pb-2">
          <p className="mb-1.5 text-[11px] font-semibold text-fg-subtle">Observations on the timeline</p>
          <div className="relative h-6 rounded-md bg-surface-3" aria-label="Observation timeline" role="group">
            {duration !== null && (
              <span
                className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-fg/70"
                style={{ left: `${percent(current)}%` }}
                aria-hidden
              />
            )}
            {duration !== null &&
              markers.map((marker, index) => {
                const left = percent(marker.startSec);
                const width = marker.endSec !== null ? Math.max(1.5, percent(marker.endSec) - left) : 1.5;
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => seek(marker.startSec)}
                    title={`${formatSeconds(marker.startSec)} · ${marker.label}`}
                    aria-label={`Play from ${formatSeconds(marker.startSec)}: ${marker.label}`}
                    className="absolute top-1 bottom-1 min-w-2.5 rounded-sm opacity-85 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-fg"
                    style={{ left: `${left}%`, width: `${width}%`, backgroundColor: marker.color }}
                  />
                );
              })}
          </div>
          <p className="mt-1 flex justify-between text-[10px] text-fg-faint tabular-nums">
            <span>0:00</span>
            <span>{duration !== null ? formatSeconds(duration) : '–:––'}</span>
          </p>
        </div>
      )}
    </div>
  );
}

/** The browser's PDF viewer, opened at a page, with page navigation. */
export function PdfPreview({ src, title, pages }: { src: string; title: string; pages: number | null }) {
  const [page, setPage] = useState(1);
  const last = pages ?? Infinity;
  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-xs text-fg-subtle">
        <Button size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
          <ChevronLeft className="size-3.5" aria-hidden /> Previous page
        </Button>
        <span aria-live="polite" className="tabular-nums">
          Page {page}
          {pages !== null && ` of ${pages}`}
        </span>
        <Button size="sm" onClick={() => setPage((p) => Math.min(last, p + 1))} disabled={page >= last}>
          Next page <ChevronRight className="size-3.5" aria-hidden />
        </Button>
      </div>
      {/* Keyed by page: changing only the fragment of an iframe does not move the PDF viewer. */}
      <iframe key={page} src={`${src}#page=${page}&view=FitH`} title={`${title}, page ${page}`} className="h-[60vh] w-full bg-white" />
    </div>
  );
}

/** A prominent "not inspected" label over files the AI cannot read. */
export function NotInspectedLabel({ reason }: { reason: string }) {
  return (
    <p className="flex w-full items-start gap-2 border-b border-uncertain/40 bg-uncertain/15 px-3 py-2 text-xs text-uncertain-fg">
      <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-bold uppercase">Not inspected</strong> — {reason}
      </span>
    </p>
  );
}
