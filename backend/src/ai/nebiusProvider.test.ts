import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentPart } from '../lib/nebius.js';
import { LocalFileStore } from '../stores/fileStore.js';
import { makePdf } from '../test/fixtures.js';
import type { Evidence, Requirement, WorkOrder } from '../types.js';
import { NebiusNemotronProvider } from './nebiusProvider.js';

const dir = mkdtempSync(join(tmpdir(), 'evidenceloop-nebius-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

const files = new LocalFileStore(dir);
const workOrder = { id: 'wo', title: 'Replace emergency light in Room 204', location: 'Room 204', description: '' } as WorkOrder;
const requirement = { id: 'req-1', title: 'Correct unit installed', description: 'EL-200', mandatory: true } as Requirement;

async function evidence(id: string, mimeType: string, data: Buffer): Promise<Evidence> {
  const storagePath = `wo/${id}/file`;
  await files.put(storagePath, data);
  return { id, kind: 'document', fileName: `${id}.bin`, mimeType, sizeBytes: data.length, storagePath, note: '' } as Evidence;
}

function stubNebius(reply: string) {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify({ choices: [{ message: { content: reply } }] })),
  );
  vi.stubGlobal('fetch', fetch);
  return () => {
    const body = JSON.parse(fetch.mock.calls[0]![1].body as string) as {
      messages: { content: string | ContentPart[] }[];
    };
    return body.messages[1]!.content as ContentPart[];
  };
}

describe('NebiusNemotronProvider', () => {
  const provider = new NebiusNemotronProvider({ apiKey: 'k', baseUrl: 'https://example.invalid/v1', model: 'nvidia/vl' }, files);

  it('sends PDF text, declares scans and audio as not inspected, and parses a fenced reply', async () => {
    const sent = stubNebius(
      `<think>reasoning</think>\n\`\`\`json\n${JSON.stringify({ assessments: [{ requirementId: 'req-1', status: 'NOT_PROVEN' }] })}\n\`\`\``,
    );
    const items = [
      await evidence('manual', 'application/pdf', makePdf(['Install model EL-200 only.'])),
      await evidence('scan', 'application/pdf', makePdf([''])),
      await evidence('voice', 'audio/mpeg', Buffer.from('mp3')),
      await evidence('clip', 'video/mp4', Buffer.from('not really a video')),
    ];

    const result = await provider.assess({ workOrder, requirements: [requirement], evidence: items });
    expect(result).toEqual([{ requirementId: 'req-1', status: 'NOT_PROVEN' }]);

    const text = sent()
      .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    expect(text).toMatch(/evidenceId=manual .*Extracted text layer follows[\s\S]*EL-200/);
    expect(text).toMatch(/evidenceId=scan .*attached but NOT inspected \(PDF no text layer/);
    expect(text).toMatch(/evidenceId=voice .*attached but NOT inspected \(audio transcription is not available\)/);
    expect(text).toMatch(/evidenceId=clip .*attached but NOT inspected \(video/);
  });

  it('returns no assessments when the reply is not JSON, so the policy defaults to NOT_PROVEN', async () => {
    stubNebius('I think everything looks fine!');
    const items = [await evidence('note', 'text/plain', Buffer.from('done'))];
    await expect(provider.assess({ workOrder, requirements: [requirement], evidence: items })).resolves.toEqual([]);
  });
});
