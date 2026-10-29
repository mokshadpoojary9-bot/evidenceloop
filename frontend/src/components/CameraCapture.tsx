import { Camera, CameraOff, Check, Circle, LoaderCircle, RotateCcw, Square, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cameraErrorMessage,
  capturedFile,
  compressPhoto,
  pickRecorderType,
  VIDEO_MAX_SECONDS,
  type CaptureInfo,
  type CaptureMode,
} from '../lib/capture';
import { Button, Modal } from './ui';

interface Props {
  mode: CaptureMode;
  /** Shown as the dialog title, e.g. "Take an after photo". */
  title: string;
  onUse: (file: File, capture: CaptureInfo) => void;
  /** Falls back to choosing a file (camera denied, missing, or not wanted). */
  onUploadInstead: () => void;
  onClose: () => void;
}

type Phase =
  | { name: 'starting' }
  | { name: 'live' }
  | { name: 'recording'; secondsLeft: number }
  | { name: 'processing' }
  | { name: 'review'; file: File; url: string; capturedAt: Date }
  | { name: 'error'; message: string };

/**
 * Laptop and desktop camera: a live preview, then Capture photo or Record (up to 15 s), then
 * Retake or Use this. Phones use their own camera app instead (see CaptureButtons). The camera
 * is released whenever the dialog closes, a capture is reviewed, or the component unmounts.
 */
export function CameraCapture({ mode, title, onUse, onUploadInstead, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'starting' });
  const reviewUrl = phase.name === 'review' ? phase.url : null;

  const stopCamera = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === 'recording') {
      recorder.current.ondataavailable = null;
      recorder.current.onstop = null;
      recorder.current.stop();
    }
    recorder.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    setPhase({ name: 'starting' });
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase({ name: 'error', message: cameraErrorMessage({ name: 'Unsupported' }) });
      return;
    }
    const videoConstraints = { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };
    try {
      let media: MediaStream;
      try {
        // Video evidence keeps its sound (a test beep can matter); fall back to video only.
        media = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: mode === 'video' });
      } catch (error) {
        if (mode !== 'video') throw error;
        media = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
      }
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        try {
          await video.current.play();
        } catch {
          // autoplay is muted and inline; a refused play() still shows the first frame
        }
      }
      setPhase({ name: 'live' });
    } catch (error) {
      stopCamera();
      setPhase({ name: 'error', message: cameraErrorMessage(error) });
    }
  }, [mode, stopCamera]);

  useEffect(() => {
    void startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  useEffect(() => () => void (reviewUrl && URL.revokeObjectURL(reviewUrl)), [reviewUrl]);

  const review = (file: File, capturedAt: Date) => {
    stopCamera();
    setPhase({ name: 'review', file, url: URL.createObjectURL(file), capturedAt });
  };

  const takePhoto = async () => {
    const element = video.current;
    if (!element || !element.videoWidth) return;
    setPhase({ name: 'processing' });
    const capturedAt = new Date();
    const canvas = document.createElement('canvas');
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    canvas.getContext('2d')?.drawImage(element, 0, 0);
    const raw = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    if (!raw) {
      setPhase({ name: 'error', message: 'The photo could not be captured. Try again, or upload a file instead.' });
      return;
    }
    review(capturedFile(await compressPhoto(raw), 'photo', capturedAt), capturedAt);
  };

  const startRecording = () => {
    const media = stream.current;
    if (!media || typeof MediaRecorder === 'undefined') {
      setPhase({ name: 'error', message: cameraErrorMessage({ name: 'Unsupported' }) });
      return;
    }
    const type = pickRecorderType((candidate) => MediaRecorder.isTypeSupported(candidate));
    const chunks: Blob[] = [];
    const capturedAt = new Date();
    const rec = new MediaRecorder(media, type ? { mimeType: type } : undefined);
    rec.ondataavailable = (event) => event.data.size > 0 && chunks.push(event.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || type || 'video/webm' });
      if (blob.size === 0) {
        setPhase({ name: 'error', message: 'Nothing was recorded. Try again, or upload a file instead.' });
        return;
      }
      review(capturedFile(blob, 'video', capturedAt), capturedAt);
    };
    recorder.current = rec;
    rec.start(1000);
    let secondsLeft = VIDEO_MAX_SECONDS;
    setPhase({ name: 'recording', secondsLeft });
    timer.current = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) stopRecording();
      else setPhase({ name: 'recording', secondsLeft });
    }, 1000);
  };

  const stopRecording = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === 'recording') {
      setPhase({ name: 'processing' });
      recorder.current.stop();
    }
  };

  const close = () => {
    stopCamera();
    onClose();
  };

  const live = phase.name === 'live' || phase.name === 'recording' || phase.name === 'starting' || phase.name === 'processing';

  return (
    <Modal open title={title} onClose={close}>
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-xl border border-line bg-black">
          {/* The live preview stays mounted while the camera runs; the review replaces it. */}
          <video
            ref={video}
            muted
            playsInline
            autoPlay
            aria-label="Camera preview"
            className={`aspect-video w-full object-contain ${live ? '' : 'hidden'}`}
          />
          {phase.name === 'review' &&
            (mode === 'photo' ? (
              <img src={phase.url} alt="The photo you took" className="aspect-video w-full object-contain" />
            ) : (
              <video src={phase.url} controls playsInline aria-label="The video you recorded" className="aspect-video w-full object-contain" />
            ))}
          {phase.name === 'error' && (
            <div className="flex aspect-video flex-col items-center justify-center gap-2 p-4 text-center">
              <CameraOff className="size-8 text-fg-faint" aria-hidden />
            </div>
          )}
          {(phase.name === 'starting' || phase.name === 'processing') && (
            <p role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 text-sm text-white">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              {phase.name === 'starting' ? 'Opening the camera… Allow access if your browser asks.' : 'Preparing…'}
            </p>
          )}
          {phase.name === 'recording' && (
            <p
              role="timer"
              aria-live="polite"
              className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-md bg-black/70 px-2 py-1 text-xs font-semibold text-white tabular-nums"
            >
              <Circle className="size-2.5 animate-pulse fill-contradicted text-contradicted" aria-hidden />
              Recording · {phase.secondsLeft}s left
            </p>
          )}
        </div>

        {phase.name === 'error' ? (
          <p role="alert" className="text-sm text-contradicted-fg">
            {phase.message}
          </p>
        ) : (
          <p className="text-xs text-fg-subtle">
            {mode === 'photo'
              ? 'Frame the work clearly. The photo is resized for a fast upload.'
              : `Up to ${VIDEO_MAX_SECONDS} seconds. Recording stops automatically.`}{' '}
            It is tagged “Captured in app” with the time in the audit trail.
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {phase.name === 'error' && (
            <>
              <Button onClick={() => void startCamera()}>
                <RotateCcw className="size-4" aria-hidden /> Try again
              </Button>
              <Button variant="primary" onClick={onUploadInstead}>
                <Upload className="size-4" aria-hidden /> Upload a file instead
              </Button>
            </>
          )}
          {phase.name === 'live' && mode === 'photo' && (
            <Button variant="primary" onClick={() => void takePhoto()}>
              <Camera className="size-4" aria-hidden /> Capture photo
            </Button>
          )}
          {phase.name === 'live' && mode === 'video' && (
            <Button variant="primary" onClick={startRecording}>
              <Circle className="size-4 fill-current" aria-hidden /> Record
            </Button>
          )}
          {phase.name === 'recording' && (
            <Button variant="danger" onClick={stopRecording}>
              <Square className="size-4 fill-current" aria-hidden /> Stop
            </Button>
          )}
          {phase.name === 'review' && (
            <>
              <Button onClick={() => void startCamera()}>
                <RotateCcw className="size-4" aria-hidden /> Retake
              </Button>
              <Button variant="primary" onClick={() => onUse(phase.file, { capturedAt: phase.capturedAt.toISOString() })}>
                <Check className="size-4" aria-hidden /> Use this
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
