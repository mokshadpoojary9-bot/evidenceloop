import { deflateSync } from 'node:zlib';
import { chatCompletion, NebiusError, type ChatDeps, type NebiusConfig } from '../lib/nebius.js';

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  /** Error message (never contains the key), or a note about an unexpected answer. */
  detail: string | null;
}

export interface LiveCheckResult {
  text: ProbeResult;
  /** Null when the text probe already failed, so the image probe was not attempted. */
  image: ProbeResult | null;
}

/** A solid red PNG, built in code so the check needs no fixture file. */
export function solidPng(size = 64, rgb: [number, number, number] = [220, 30, 30]): Buffer {
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const describe = (error: unknown) =>
  error instanceof NebiusError ? error.message : `Unexpected error: ${(error as Error)?.message ?? error}`;

async function timed(run: () => Promise<string>, accept: (answer: string) => boolean): Promise<ProbeResult> {
  const started = Date.now();
  try {
    // Reasoning models may think out loud first; judge only the final answer.
    const answer = (await run()).replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '').trim();
    const ok = accept(answer);
    return {
      ok,
      latencyMs: Date.now() - started,
      detail: ok ? null : `Unexpected answer: ${answer.slice(0, 120)}`,
    };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, detail: describe(error) };
  }
}

/**
 * One small text request and one small image request against the configured model.
 * The image request tells a vision-capable model apart from a text-only one.
 */
export async function runLiveCheck(config: NebiusConfig, deps: ChatDeps = {}): Promise<LiveCheckResult> {
  const options = { maxTokens: 2048, timeoutMs: 60_000, retries: 1 };

  const text = await timed(
    () =>
      chatCompletion(
        config,
        [{ role: 'user', content: 'Reply with exactly the word OK and nothing else.' }],
        options,
        deps,
      ),
    (answer) => /\bOK\b/i.test(answer),
  );
  if (!text.ok) return { text, image: null };

  const image = await timed(
    () =>
      chatCompletion(
        config,
        [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is the single dominant colour of this image? Answer with one word.' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${solidPng().toString('base64')}` } },
            ],
          },
        ],
        options,
        deps,
      ),
    (answer) => /\bred\b/i.test(answer),
  );
  return { text, image };
}
