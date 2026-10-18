import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { extractPdfText } from './pdfText.js';
import { defaultFfmpegRunner, ffmpegPath, sampleVideoFrames } from './videoFrames.js';

export interface MediaCheck {
  ok: boolean;
  detail: string;
}

export interface MediaReport {
  video: MediaCheck;
  pdf: MediaCheck;
}

const PDF_MARKER = 'EvidenceLoop media self-check';

function tinyPdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.text(PDF_MARKER);
    doc.end();
  });
}

/** Extracts the text layer of a generated PDF, exactly as evidence PDFs are read. */
export async function checkPdf(): Promise<MediaCheck> {
  try {
    const result = await extractPdfText(await tinyPdf());
    if (!result.ok) return { ok: false, detail: result.reason };
    if (result.text.replace(/\s+/g, ' ').includes(PDF_MARKER)) return { ok: true, detail: 'PDF text extraction works' };
    return { ok: false, detail: `extracted text did not match (${JSON.stringify(result.text.slice(0, 80))})` };
  } catch (error) {
    return { ok: false, detail: (error as Error)?.message ?? 'unknown error' };
  }
}

/** Generates a 2-second test video with ffmpeg and samples frames from it, as for video evidence. */
export async function checkVideo(): Promise<MediaCheck> {
  const binary = ffmpegPath();
  if (!binary) return { ok: false, detail: 'no ffmpeg binary for this platform (set FFMPEG_PATH)' };
  if (!existsSync(binary)) return { ok: false, detail: 'ffmpeg binary missing (the ffmpeg-static install script did not run)' };

  const dir = await mkdtemp(join(tmpdir(), 'evidenceloop-selfcheck-'));
  try {
    const video = join(dir, 'test.mp4');
    const made = await defaultFfmpegRunner([
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=5',
      '-pix_fmt', 'yuv420p', '-y', video,
    ]);
    if (made.code !== 0) return { ok: false, detail: `ffmpeg could not encode a test video (exit ${made.code})` };
    const frames = await sampleVideoFrames(await readFile(video), { intervalSec: 1, maxFrames: 2 });
    if (!frames.ok) return { ok: false, detail: frames.reason };
    return { ok: true, detail: `ffmpeg works (${frames.frames.length} frames sampled)` };
  } catch (error) {
    return { ok: false, detail: (error as Error)?.message ?? 'unknown error' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function checkMedia(): Promise<MediaReport> {
  const [video, pdf] = await Promise.all([checkVideo(), checkPdf()]);
  return { video, pdf };
}
