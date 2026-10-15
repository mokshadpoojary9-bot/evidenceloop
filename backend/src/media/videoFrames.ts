import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

export interface VideoFrame {
  /** Position of the frame in the video, in seconds. */
  timeSec: number;
  jpeg: Buffer;
}

export type VideoFramesResult =
  | { ok: true; frames: VideoFrame[]; durationSec: number | null; hasAudio: boolean }
  | { ok: false; reason: string };

/** Runs ffmpeg with the given arguments. Injectable so tests can mock ffmpeg. */
export type FfmpegRunner = (args: string[]) => Promise<{ code: number | null; stderr: string }>;

export interface SampleOptions {
  /** Target spacing between frames; widened for long videos so frames cover the whole clip. */
  intervalSec?: number;
  maxFrames?: number;
  /** Longest edge of an extracted frame, in pixels. */
  maxWidth?: number;
  runner?: FfmpegRunner;
}

const FFMPEG_TIMEOUT_MS = 30_000;

export const defaultFfmpegRunner: FfmpegRunner = (args) =>
  new Promise((resolve, reject) => {
    const binary = ffmpegStatic as unknown as string | null;
    if (!binary) return reject(new Error('ffmpeg binary is not available on this platform'));
    const child = spawn(binary, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 64_000) stderr += chunk.toString('utf8');
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), FFMPEG_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });

/** Parses "Duration: 00:01:02.50" from ffmpeg's input banner. */
export function parseDuration(stderr: string): number | null {
  const match = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** Timestamps to sample: every `intervalSec`, spread wider when the clip is long. */
export function frameTimestamps(durationSec: number | null, intervalSec: number, maxFrames: number): number[] {
  if (durationSec === null || durationSec <= 0) {
    return Array.from({ length: maxFrames }, (_, i) => i * intervalSec);
  }
  const step = Math.max(intervalSec, durationSec / maxFrames);
  const times: number[] = [];
  for (let t = 0; t < durationSec && times.length < maxFrames; t += step) {
    times.push(Math.round(t * 10) / 10);
  }
  return times;
}

/**
 * Samples still frames from a video (about one every 2 s, at most 8) so a vision
 * model can inspect it with timestamps. Audio is not transcribed.
 */
export async function sampleVideoFrames(data: Buffer, options: SampleOptions = {}): Promise<VideoFramesResult> {
  const { intervalSec = 2, maxFrames = 8, maxWidth = 768, runner = defaultFfmpegRunner } = options;
  const dir = await mkdtemp(join(tmpdir(), 'evidenceloop-video-'));
  try {
    const input = join(dir, 'input');
    await writeFile(input, data);

    // `ffmpeg -i` with no output exits non-zero by design; only the banner is needed.
    const probe = await runner(['-hide_banner', '-i', input]);
    if (/Invalid data found|could not find codec|moov atom not found/i.test(probe.stderr)) {
      return { ok: false, reason: 'the file could not be decoded as a video' };
    }
    const durationSec = parseDuration(probe.stderr);
    const hasAudio = /Stream #\S+.*Audio:/.test(probe.stderr);

    const frames: VideoFrame[] = [];
    for (const [index, timeSec] of frameTimestamps(durationSec, intervalSec, maxFrames).entries()) {
      const output = join(dir, `frame-${index}.jpg`);
      const result = await runner([
        '-hide_banner', '-loglevel', 'error',
        '-ss', String(timeSec), '-i', input,
        '-frames:v', '1',
        '-vf', `scale='min(${maxWidth},iw)':-2`,
        '-q:v', '4',
        '-y', output,
      ]);
      if (result.code !== 0) continue;
      const jpeg = await readFile(output).catch(() => null);
      // Seeking past the end yields no frame; stop there.
      if (!jpeg || jpeg.length === 0) break;
      frames.push({ timeSec, jpeg });
    }

    if (frames.length === 0) return { ok: false, reason: 'no frames could be extracted' };
    return { ok: true, frames, durationSec, hasAudio };
  } catch (error) {
    return { ok: false, reason: `frame extraction failed (${(error as Error)?.message ?? 'unknown error'})` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
