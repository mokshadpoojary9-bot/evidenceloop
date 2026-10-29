// Evidence taken with the camera: turning a capture into an upload-ready File, and shrinking
// photos before upload. Pure where possible, so the rules are tested without a camera.

export const PHOTO_MAX_SIDE = 2000;
export const PHOTO_QUALITY = 0.85;
export const VIDEO_MAX_SECONDS = 15;
/** A phone camera file older than this was most likely picked from the gallery, not just taken. */
export const FRESH_CAPTURE_MS = 2 * 60_000;

export type CaptureMode = 'photo' | 'video';

/** What the upload records about an in-app capture. */
export interface CaptureInfo {
  /** ISO time the device reported for the capture. */
  capturedAt: string;
}

/** Dimensions scaled down (never up) so the long side is at most `maxSide`. */
export function fitWithin(width: number, height: number, maxSide = PHOTO_MAX_SIDE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxSide || long === 0) return { width, height };
  const scale = maxSide / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** "video/webm;codecs=vp8,opus" → "video/webm": the type the upload checks compare against. */
export const baseMime = (type: string) => type.split(';')[0]!.trim().toLowerCase();

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/** A readable, sortable name such as `photo-2026-10-29T10-15-30.jpg`. */
export function captureFileName(mode: CaptureMode, mime: string, at: Date): string {
  const stamp = at.toISOString().slice(0, 19).replace(/:/g, '-');
  return `${mode}-${stamp}.${EXTENSIONS[baseMime(mime)] ?? 'bin'}`;
}

/** The captured bytes as a File the normal upload path accepts. */
export function capturedFile(blob: Blob, mode: CaptureMode, at: Date): File {
  const type = baseMime(blob.type) || (mode === 'photo' ? 'image/jpeg' : 'video/webm');
  return new File([blob], captureFileName(mode, type, at), { type, lastModified: at.getTime() });
}

const RECORDER_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

/** The first recording format this browser supports; '' lets MediaRecorder choose. */
export function pickRecorderType(isTypeSupported: (type: string) => boolean): string {
  return RECORDER_TYPES.find((type) => isTypeSupported(type)) ?? '';
}

/** Whether a phone camera file was taken just now (and can honestly be called a capture). */
export function isFreshCapture(file: File, now = Date.now()): boolean {
  return file.lastModified > 0 && now - file.lastModified >= -FRESH_CAPTURE_MS && now - file.lastModified <= FRESH_CAPTURE_MS;
}

/** Phones and tablets: their own camera app is better than a preview in the page. */
export function prefersNativeCamera(): boolean {
  try {
    return window.matchMedia('(pointer: coarse) and (hover: none)').matches;
  } catch {
    return false;
  }
}

export interface ImageCodec {
  decode(blob: Blob): Promise<{ width: number; height: number; source: CanvasImageSource; close?: () => void }>;
  encode(source: CanvasImageSource, width: number, height: number, quality: number): Promise<Blob>;
}

/** The browser's decoder (respecting EXIF rotation) and a canvas JPEG encoder. */
export const browserCodec: ImageCodec = {
  async decode(blob) {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() };
  },
  encode(source, width, height, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return Promise.reject(new Error('Canvas is not available'));
    context.drawImage(source, 0, 0, width, height);
    return new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo'))), 'image/jpeg', quality),
    );
  },
};

/**
 * A photo re-encoded as JPEG with the long side at most 2000 px, so uploads are fast. The
 * original is kept when it is already a small JPEG, or if the browser cannot re-encode it.
 */
export async function compressPhoto(
  blob: Blob,
  codec: ImageCodec = browserCodec,
  maxSide = PHOTO_MAX_SIDE,
  quality = PHOTO_QUALITY,
): Promise<Blob> {
  let image: Awaited<ReturnType<ImageCodec['decode']>>;
  try {
    image = await codec.decode(blob);
  } catch {
    return blob;
  }
  try {
    const size = fitWithin(image.width, image.height, maxSide);
    const resized = size.width !== image.width || size.height !== image.height;
    if (!resized && baseMime(blob.type) === 'image/jpeg') return blob;
    const encoded = await codec.encode(image.source, size.width, size.height, quality);
    return !resized && encoded.size >= blob.size ? blob : encoded;
  } catch {
    return blob;
  } finally {
    image.close?.();
  }
}

/** A friendly reason for a getUserMedia failure; every case still offers a file upload. */
export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error || (error && typeof error === 'object' && 'name' in error) ? (error as { name: string }).name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow the camera for this site in your browser settings, or upload a file instead.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. Upload a file instead.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is in use by another app, or could not start. Close the other app and try again, or upload a file instead.';
    case 'Unsupported':
      return 'This browser cannot open the camera here. Upload a file instead.';
    default:
      return 'The camera could not be started. Upload a file instead.';
  }
}
