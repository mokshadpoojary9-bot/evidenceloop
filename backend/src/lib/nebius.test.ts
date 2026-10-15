import { describe, expect, it, vi } from 'vitest';
import { runLiveCheck } from '../ai/liveCheck.js';
import { chatCompletion, NebiusError } from './nebius.js';

const config = { apiKey: 'test-key', baseUrl: 'https://example.invalid/v1/', model: 'nvidia/test-model' };
const messages = [{ role: 'user' as const, content: 'hi' }];

const completion = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

function mockFetch(...responses: (Response | Error)[]) {
  const fn = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  });
  return fn as unknown as typeof fetch & typeof fn;
}

const sleep = vi.fn(async () => {});

describe('chatCompletion', () => {
  it('returns the completion text and sends the model and key', async () => {
    const fetch = mockFetch(completion('hello'));
    await expect(chatCompletion(config, messages, {}, { fetch, sleep })).resolves.toBe('hello');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.invalid/v1/chat/completions');
    expect(JSON.parse(init.body as string).model).toBe('nvidia/test-model');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });

  it('retries 429 and 5xx with backoff, honouring Retry-After', async () => {
    sleep.mockClear();
    const fetch = mockFetch(
      new Response('slow down', { status: 429, headers: { 'retry-after': '3' } }),
      new Response('oops', { status: 503 }),
      completion('ok'),
    );
    await expect(chatCompletion(config, messages, {}, { fetch, sleep })).resolves.toBe('ok');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((call) => (call as unknown as [number])[0])).toEqual([3000, 2000]);
  });

  it('gives up after the retry budget', async () => {
    const fetch = mockFetch(...Array.from({ length: 5 }, () => new Response('', { status: 502 })));
    await expect(chatCompletion(config, messages, { retries: 2 }, { fetch, sleep })).rejects.toMatchObject({
      code: 'UPSTREAM',
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries timeouts and network errors', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const fetch = mockFetch(timeout, new TypeError('fetch failed'), completion('ok'));
    await expect(chatCompletion(config, messages, {}, { fetch, sleep })).resolves.toBe('ok');
  });

  it('fails fast with a clear message on 401 and never echoes the key', async () => {
    const fetch = mockFetch(new Response('invalid token', { status: 401 }));
    const error = (await chatCompletion(config, messages, {}, { fetch, sleep }).catch((e: unknown) => e)) as NebiusError;
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.message).toContain('NEBIUS_API_KEY');
    expect(error.message).not.toContain('test-key');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('names the model on 404', async () => {
    const fetch = mockFetch(new Response('{"detail":"Model not found"}', { status: 404 }));
    await expect(chatCompletion(config, messages, {}, { fetch, sleep })).rejects.toMatchObject({
      code: 'MODEL_NOT_FOUND',
      message: expect.stringContaining('nvidia/test-model'),
    });
  });

  it('treats an empty completion as an error', async () => {
    const fetch = mockFetch(completion(''));
    await expect(chatCompletion(config, messages, {}, { fetch, sleep })).rejects.toMatchObject({ code: 'EMPTY' });
  });
});

describe('runLiveCheck', () => {
  it('passes when the model answers text and identifies the image colour', async () => {
    const fetch = mockFetch(completion('<think>easy</think>OK'), completion('Red.'));
    const result = await runLiveCheck(config, { fetch, sleep });
    expect(result.text.ok).toBe(true);
    expect(result.image?.ok).toBe(true);
  });

  it('reports a text-only model as not vision-capable', async () => {
    const fetch = mockFetch(completion('OK'), new Response('image input is not supported', { status: 400 }));
    const result = await runLiveCheck(config, { fetch, sleep });
    expect(result.text.ok).toBe(true);
    expect(result.image).toMatchObject({ ok: false, detail: expect.stringContaining('not supported') });
  });

  it('skips the image request when the text request fails', async () => {
    const fetch = mockFetch(new Response('', { status: 401 }));
    const result = await runLiveCheck(config, { fetch, sleep });
    expect(result.text.ok).toBe(false);
    expect(result.image).toBeNull();
  });
});
