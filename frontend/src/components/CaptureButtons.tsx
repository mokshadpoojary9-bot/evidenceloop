import { Camera, Video } from 'lucide-react';
import { lazy, Suspense, useRef, useState } from 'react';
import { compressPhoto, capturedFile, isFreshCapture, prefersNativeCamera, type CaptureInfo, type CaptureMode } from '../lib/capture';
import { Button } from './ui';

// The camera dialog (getUserMedia, MediaRecorder) loads only when someone opens it.
const CameraCapture = lazy(() => import('./CameraCapture').then((module) => ({ default: module.CameraCapture })));

interface Props {
  /** Which buttons to show. */
  modes: CaptureMode[];
  disabled?: boolean;
  /** What is being captured, for labels: e.g. "after photo". */
  label?: Partial<Record<CaptureMode, string>>;
  /** Called before capturing, e.g. to pick a matching evidence type. */
  onBeforeCapture?: (mode: CaptureMode) => void;
  /** The captured file, ready for the normal upload path. `capture` is null when it cannot honestly be called a fresh capture. */
  onCaptured: (file: File, capture: CaptureInfo | null) => void;
  /** Opens the ordinary file picker (fallback when the camera is unavailable). */
  onUploadInstead: () => void;
}

/**
 * "Take photo" and "Record video". On phones the camera app opens directly (`capture`); on
 * laptops a dialog shows a live preview. Either way the result goes through the same upload.
 */
export function CaptureButtons({ modes, disabled, label = {}, onBeforeCapture, onCaptured, onUploadInstead }: Props) {
  const [open, setOpen] = useState<CaptureMode | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  const begin = (mode: CaptureMode) => {
    onBeforeCapture?.(mode);
    if (prefersNativeCamera()) (mode === 'photo' ? photoInput : videoInput).current?.click();
    else setOpen(mode);
  };

  const fromPhone = async (file: File, mode: CaptureMode) => {
    // A file older than a couple of minutes was probably picked from the gallery: upload it,
    // but do not claim it was captured in the app.
    const fresh = isFreshCapture(file);
    const at = new Date(fresh ? file.lastModified : Date.now());
    const ready = mode === 'photo' ? capturedFile(await compressPhoto(file), 'photo', at) : file;
    onCaptured(ready, fresh ? { capturedAt: at.toISOString() } : null);
  };

  const text = (mode: CaptureMode) => (mode === 'photo' ? `Take ${label.photo ?? 'photo'}` : `Record ${label.video ?? 'video'}`);

  return (
    <>
      {modes.map((mode) => {
        const Icon = mode === 'photo' ? Camera : Video;
        return (
          <Button key={mode} onClick={() => begin(mode)} disabled={disabled}>
            <Icon className="size-4" aria-hidden /> {text(mode)}
          </Button>
        );
      })}

      {/* Phones: these open the rear camera directly. */}
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void fromPhone(file, 'photo');
        }}
      />
      <input
        ref={videoInput}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void fromPhone(file, 'video');
        }}
      />

      {open && (
        <Suspense fallback={null}>
          <CameraCapture
            mode={open}
            title={text(open)}
            onClose={() => setOpen(null)}
            onUploadInstead={() => {
              setOpen(null);
              onUploadInstead();
            }}
            onUse={(file, capture) => {
              setOpen(null);
              onCaptured(file, capture);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
