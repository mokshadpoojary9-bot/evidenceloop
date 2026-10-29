import { describe, expect, it } from 'vitest';
import {
  baseMime,
  cameraErrorMessage,
  captureFileName,
  capturedFile,
  compressPhoto,
  fitWithin,
  isFreshCapture,
  pickRecorderType,
  type ImageCodec,
} from './capture';

const AT = new Date('2026-10-29T10:15:30.000Z');

describe('capture → file', () => {
  it('names the file by capture time and type, and strips codec parameters', () => {
    expect(captureFileName('photo', 'image/jpeg', AT)).toBe('photo-2026-10-29T10-15-30.jpg');
    expect(captureFileName('video', 'video/webm;codecs=vp8,opus', AT)).toBe('video-2026-10-29T10-15-30.webm');
    expect(captureFileName('video', 'video/mp4', AT)).toBe('video-2026-10-29T10-15-30.mp4');
    expect(baseMime('video/webm; codecs="vp9"')).toBe('video/webm');
  });

  it('builds a File the normal upload checks accept', async () => {
    const file = capturedFile(new Blob(['frames'], { type: 'video/webm;codecs=vp9,opus' }), 'video', AT);
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('video/webm');
    expect(file.name).toBe('video-2026-10-29T10-15-30.webm');
    expect(file.lastModified).toBe(AT.getTime());
    expect(await file.text()).toBe('frames');
    // A blob without a type still becomes a typed file.
    expect(capturedFile(new Blob(['x']), 'photo', AT).type).toBe('image/jpeg');
  });

  it('records in the first format the browser supports', () => {
    expect(pickRecorderType((type) => type.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus');
    expect(pickRecorderType((type) => type === 'video/mp4')).toBe('video/mp4');
    expect(pickRecorderType(() => false)).toBe('');
  });

  it('only calls a phone camera file a capture when it was taken just now', () => {
    const now = AT.getTime();
    expect(isFreshCapture(new File(['x'], 'a.jpg', { lastModified: now - 10_000 }), now)).toBe(true);
    expect(isFreshCapture(new File(['x'], 'a.jpg', { lastModified: now - 60 * 60_000 }), now)).toBe(false);
  });

  it('explains camera failures in plain words', () => {
    expect(cameraErrorMessage(new DOMException('denied', 'NotAllowedError'))).toMatch(/blocked/);
    expect(cameraErrorMessage(new DOMException('none', 'NotFoundError'))).toMatch(/No camera/);
    expect(cameraErrorMessage({ name: 'Unsupported' })).toMatch(/cannot open the camera/);
    expect(cameraErrorMessage(new Error('?'))).toMatch(/Upload a file instead/);
  });
});

describe('photo compression', () => {
  /** A codec that records what it was asked to encode. */
  function fakeCodec(width: number, height: number, encodedBytes: number) {
    const calls: { width: number; height: number; quality: number }[] = [];
    let closed = false;
    const codec: ImageCodec = {
      decode: async () => ({ width, height, source: {} as CanvasImageSource, close: () => (closed = true) }),
      encode: async (_source, w, h, quality) => {
        calls.push({ width: w, height: h, quality });
        return new Blob([new Uint8Array(encodedBytes)], { type: 'image/jpeg' });
      },
    };
    return { codec, calls, closed: () => closed };
  }

  it('scales the long side down to 2000 px', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it('re-encodes a large photo as JPEG at quality 0.85 and releases the decoded image', async () => {
    const { codec, calls, closed } = fakeCodec(4032, 3024, 500);
    const out = await compressPhoto(new Blob([new Uint8Array(5000)], { type: 'image/png' }), codec);
    expect(calls).toEqual([{ width: 2000, height: 1500, quality: 0.85 }]);
    expect(out.type).toBe('image/jpeg');
    expect(out.size).toBe(500);
    expect(closed()).toBe(true);
  });

  it('keeps a small JPEG as it is, and keeps the original if re-encoding would not help', async () => {
    const small = new Blob([new Uint8Array(100)], { type: 'image/jpeg' });
    const first = fakeCodec(800, 600, 50);
    expect(await compressPhoto(small, first.codec)).toBe(small);
    expect(first.calls).toHaveLength(0);

    const png = new Blob([new Uint8Array(100)], { type: 'image/png' });
    expect(await compressPhoto(png, fakeCodec(800, 600, 400).codec)).toBe(png);
  });

  it('falls back to the original when the browser cannot decode it', async () => {
    const blob = new Blob(['not an image'], { type: 'image/heic' });
    const codec: ImageCodec = { decode: () => Promise.reject(new Error('no')), encode: () => Promise.reject(new Error('no')) };
    expect(await compressPhoto(blob, codec)).toBe(blob);
  });
});
