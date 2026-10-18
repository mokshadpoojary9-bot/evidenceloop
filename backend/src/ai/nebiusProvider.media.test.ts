import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentPart } from '../lib/nebius.js';
import { LocalFileStore } from '../stores/fileStore.js';
import type { Evidence, Requirement, WorkOrder } from '../types.js';
import { NebiusNemotronProvider } from './nebiusProvider.js';

// ffmpeg is mocked so the test can check exactly which frames are sent to the model.
vi.mock('../media/videoFrames.js', () => ({
  sampleVideoFrames: vi.fn(async () => ({
    ok: true,
    durationSec: 6,
    hasAudio: true,
    frames: [
      { timeSec: 0, jpeg: Buffer.from('frame-0') },
      { timeSec: 4, jpeg: Buffer.from('frame-4') },
    ],
  })),
}));

const dir = mkdtempSync(join(tmpdir(), 'evidenceloop-nebius-media-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

const files = new LocalFileStore(dir);
const workOrder = { id: 'wo', title: 'Replace emergency light in Room 204', location: 'Room 204', description: '' } as WorkOrder;
const requirement = { id: 'req-1', title: 'Indicator functioning', description: 'Green LED lit', mandatory: true } as Requirement;

async function evidence(id: string, kind: Evidence['kind'], mimeType: string, data: Buffer): Promise<Evidence> {
  const storagePath = `wo/${id}/file`;
  await files.put(storagePath, data);
  return { id, kind, fileName: `${id}.bin`, mimeType, sizeBytes: data.length, storagePath, note: '' } as Evidence;
}

describe('NebiusNemotronProvider multimodal input', () => {
  it('sends images inline and video as timestamped frames to the Nemotron model', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"assessments":[]}' } }] })),
    );
    vi.stubGlobal('fetch', fetch);
    const provider = new NebiusNemotronProvider(
      { apiKey: 'k', baseUrl: 'https://example.invalid/v1', model: 'nvidia/Nemotron-3.5-Super-VL' },
      files,
    );

    await provider.assess({
      workOrder,
      requirements: [requirement],
      evidence: [
        await evidence('photo', 'after_photo', 'image/jpeg', Buffer.from('jpeg-bytes')),
        await evidence('clip', 'video', 'video/mp4', Buffer.from('mp4-bytes')),
      ],
    });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://example.invalid/v1/chat/completions');
    const body = JSON.parse(init.body as string) as { model: string; messages: { content: string | ContentPart[] }[] };
    expect(body.model).toBe('nvidia/Nemotron-3.5-Super-VL');

    const parts = body.messages[1]!.content as ContentPart[];
    const images = parts.flatMap((part) => (part.type === 'image_url' ? [part.image_url.url] : []));
    expect(images).toEqual([
      `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`,
      `data:image/jpeg;base64,${Buffer.from('frame-0').toString('base64')}`,
      `data:image/jpeg;base64,${Buffer.from('frame-4').toString('base64')}`,
    ]);

    const text = parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
    expect(text).toMatch(/evidenceId=photo .*image follows/);
    expect(text).toMatch(/evidenceId=clip .*video of 6\.0 s, shown as 2 still frame\(s\).*soundtrack was NOT inspected/);
    expect(text).toMatch(/evidenceId=clip frame at t=.*\(0 s\)/);
    expect(text).toMatch(/evidenceId=clip frame at t=.*\(4 s\)/);
  });
});
