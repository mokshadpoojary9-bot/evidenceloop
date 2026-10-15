import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import ffmpegStatic from 'ffmpeg-static';
import { describe, expect, it, vi } from 'vitest';
import { makePdf } from '../test/fixtures.js';
import { extractPdfText } from './pdfText.js';
import {
  frameTimestamps,
  parseDuration,
  sampleVideoFrames,
  type FfmpegRunner,
} from './videoFrames.js';

describe('extractPdfText', () => {
  it('extracts the text layer of every page', async () => {
    const pdf = makePdf(['Emergency light SOP', 'Install model EL-200 only.\nTest for 30 seconds.']);
    const result = await extractPdfText(pdf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toBe(2);
    expect(result.text).toContain('Emergency light SOP');
    expect(result.text).toContain('EL-200');
    expect(result.truncated).toBe(false);
  });

  it('caps the text at the character limit and says so', async () => {
    // Many short lines: pdf.js drops glyphs that run off the edge of the page.
    const page = Array.from({ length: 20 }, () => 'A'.repeat(40)).join('\n');
    const result = await extractPdfText(makePdf([page]), 100);
    expect(result).toMatchObject({ ok: true, truncated: true });
    if (result.ok) expect(result.text).toHaveLength(100);
  });

  it('reports a scanned PDF (no text layer) as not extractable', async () => {
    const result = await extractPdfText(makePdf(['']));
    expect(result).toMatchObject({ ok: false, pages: 1, reason: expect.stringContaining('no text layer') });
  });

  it('reports a file that is not a PDF', async () => {
    const result = await extractPdfText(Buffer.from('definitely not a pdf'));
    expect(result.ok).toBe(false);
  });
});

describe('video frame sampling', () => {
  it('parses the duration from the ffmpeg banner', () => {
    expect(parseDuration('  Duration: 00:01:02.50, start: 0.000000, bitrate: 1 kb/s')).toBe(62.5);
    expect(parseDuration('no banner')).toBeNull();
  });

  it('samples about one frame every 2 s, at most 8, spread over long clips', () => {
    expect(frameTimestamps(7, 2, 8)).toEqual([0, 2, 4, 6]);
    expect(frameTimestamps(40, 2, 8)).toEqual([0, 5, 10, 15, 20, 25, 30, 35]);
    expect(frameTimestamps(null, 2, 3)).toEqual([0, 2, 4]);
  });

  it('extracts timestamped frames through ffmpeg (mocked)', async () => {
    const runner = vi.fn<FfmpegRunner>(async (args) => {
      if (!args.includes('-frames:v')) {
        return {
          code: 1,
          stderr: 'Duration: 00:00:05.00\n Stream #0:0: Video: h264\n Stream #0:1(und): Audio: aac',
        };
      }
      const seek = args[args.indexOf('-ss') + 1];
      await writeFile(args.at(-1)!, Buffer.from(`jpeg@${seek}`));
      return { code: 0, stderr: '' };
    });

    const result = await sampleVideoFrames(Buffer.from('video bytes'), { runner });
    expect(result).toMatchObject({ ok: true, durationSec: 5, hasAudio: true });
    if (!result.ok) return;
    expect(result.frames.map((frame) => frame.timeSec)).toEqual([0, 2, 4]);
    expect(result.frames[1]!.jpeg.toString()).toBe('jpeg@2');
    expect(runner).toHaveBeenCalledTimes(4); // one probe + three frames
  });

  it('stops at the end of the clip when the duration is unknown', async () => {
    let produced = 0;
    const runner: FfmpegRunner = async (args) => {
      if (args.includes('-frames:v') && produced < 2) {
        produced++;
        await writeFile(args.at(-1)!, Buffer.from('jpeg'));
      }
      return { code: 0, stderr: '' };
    };
    const result = await sampleVideoFrames(Buffer.from('x'), { runner });
    expect(result.ok && result.frames.length).toBe(2);
  });

  it('reports an undecodable file instead of inventing frames', async () => {
    const runner: FfmpegRunner = async () => ({ code: 1, stderr: 'input: Invalid data found when processing input' });
    const result = await sampleVideoFrames(Buffer.from('x'), { runner });
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('could not be decoded') });
  });

  const ffmpeg = ffmpegStatic as unknown as string | null;
  const ffmpegWorks = ffmpeg !== null && spawnSync(ffmpeg, ['-version']).status === 0;

  it.skipIf(!ffmpegWorks)('samples a real video with the bundled ffmpeg', async () => {
    const out = `${process.env.TEMP ?? '/tmp'}/evidenceloop-test-${Date.now()}.mp4`;
    spawnSync(ffmpeg!, ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=5:size=320x240:rate=10', '-pix_fmt', 'yuv420p', out]);
    const { readFile, rm } = await import('node:fs/promises');
    const result = await sampleVideoFrames(await readFile(out));
    await rm(out, { force: true });
    expect(result).toMatchObject({ ok: true, hasAudio: false });
    if (!result.ok) return;
    expect(result.frames.map((frame) => frame.timeSec)).toEqual([0, 2, 4]);
    expect(result.frames.every((frame) => frame.jpeg.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])))).toBe(true);
  }, 30_000);
});
