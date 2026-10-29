import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraCapture } from './CameraCapture';
import { CaptureButtons } from './CaptureButtons';

// A fake camera: one video track (plus audio for video), and a MediaRecorder that yields one chunk.
function fakeStream() {
  const tracks = [{ kind: 'video', stop: vi.fn() }, { kind: 'audio', stop: vi.fn() }];
  return { tracks, stream: { getTracks: () => tracks } as unknown as MediaStream };
}

class FakeRecorder {
  static isTypeSupported = (type: string) => type === 'video/webm;codecs=vp8,opus';
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? '';
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['frames'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

let getUserMedia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  URL.createObjectURL = vi.fn(() => 'blob:capture');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const props = () => ({ onUse: vi.fn(), onUploadInstead: vi.fn(), onClose: vi.fn() });

describe('CameraCapture', () => {
  it('asks for the rear camera, records a video, and hands back a typed file tagged with the capture time', async () => {
    const { stream, tracks } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const handlers = props();
    const user = userEvent.setup();
    render(<CameraCapture mode="video" title="Record video" {...handlers} />);

    await user.click(await screen.findByRole('button', { name: 'Record' }));
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ video: expect.objectContaining({ facingMode: { ideal: 'environment' } }), audio: true }),
    );
    expect(screen.getByRole('timer').textContent).toMatch(/15s left/);

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    // Reviewing a capture releases the camera.
    expect(tracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true);
    expect(screen.getByRole('button', { name: 'Retake' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Use this' }));
    const [file, capture] = handlers.onUse.mock.calls[0] as [File, { capturedAt: string }];
    expect(file.type).toBe('video/webm');
    expect(file.name).toMatch(/^video-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.webm$/);
    expect(Number.isNaN(Date.parse(capture.capturedAt))).toBe(false);
  });

  it('stops every camera track when closed', async () => {
    const { stream, tracks } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const handlers = props();
    const user = userEvent.setup();
    render(<CameraCapture mode="photo" title="Take photo" {...handlers} />);
    await screen.findByRole('button', { name: 'Capture photo' });

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(handlers.onClose).toHaveBeenCalled();
    expect(tracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true);
  });

  it('explains a denied permission and falls back to a file upload', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const handlers = props();
    const user = userEvent.setup();
    render(<CameraCapture mode="photo" title="Take photo" {...handlers} />);

    expect((await screen.findByRole('alert')).textContent).toMatch(/Camera access was blocked/);
    await user.click(screen.getByRole('button', { name: 'Upload a file instead' }));
    expect(handlers.onUploadInstead).toHaveBeenCalled();
  });

  it('says when the browser has no camera API at all', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    render(<CameraCapture mode="photo" title="Take photo" {...props()} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/cannot open the camera/);
  });
});

describe('CaptureButtons', () => {
  it('opens the camera dialog on a laptop, loading it only when asked', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const user = userEvent.setup();
    render(<CaptureButtons modes={['photo', 'video']} label={{ photo: 'after photo' }} onCaptured={vi.fn()} onUploadInstead={vi.fn()} />);

    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Take after photo' }));
    expect(await screen.findByRole('heading', { name: 'Take after photo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record video' })).toBeTruthy();
  });

  it('opens the phone camera directly and passes the fresh capture on', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const onCaptured = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<CaptureButtons modes={['video']} onCaptured={onCaptured} onUploadInstead={vi.fn()} />);
    const input = container.querySelector<HTMLInputElement>('input[accept="video/*"]')!;
    expect(input.getAttribute('capture')).toBe('environment');
    const click = vi.spyOn(input, 'click');

    await user.click(screen.getByRole('button', { name: 'Record video' }));
    expect(click).toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();

    const file = new File(['clip'], 'VID_0001.mp4', { type: 'video/mp4', lastModified: Date.now() });
    await act(async () => {
      await user.upload(input, file);
    });
    expect(onCaptured).toHaveBeenCalledWith(file, { capturedAt: expect.any(String) });
  });
});
