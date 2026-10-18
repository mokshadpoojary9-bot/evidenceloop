import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// api.ts reads VITE_API_BASE_URL when it is first imported, so each test imports a fresh copy.
async function loadApi(baseUrl: string) {
  vi.stubEnv('VITE_API_BASE_URL', baseUrl);
  vi.resetModules();
  return import('./api');
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const TEMPLATES = { templates: [] };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('waking a sleeping API server (deployed)', () => {
  it('retries reads through 502/503 and network errors, showing "waking" meanwhile', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(503, {}))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json(502, {}))
      .mockResolvedValue(json(200, TEMPLATES));
    vi.stubGlobal('fetch', fetch);
    const { api, serverWake } = await loadApi('https://api.example');

    const result = api.templates();
    await vi.advanceTimersByTimeAsync(0);
    expect(serverWake.isWaking()).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.example/api/templates');
    expect(serverWake.isWaking()).toBe(false);
  });

  it('shows "waking" while the first request hangs, before the server has ever answered', async () => {
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));
    const { api, serverWake } = await loadApi('https://api.example');

    const result = api.templates();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(serverWake.isWaking()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(serverWake.isWaking()).toBe(true);

    answer(json(200, TEMPLATES));
    await expect(result).resolves.toEqual([]);
    expect(serverWake.isWaking()).toBe(false);
  });

  it('gives up with an error after the wake deadline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { api, serverWake } = await loadApi('https://api.example');

    const result = api.templates();
    const assertion = expect(result).rejects.toThrow('did not wake up');
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
    expect(serverWake.isWaking()).toBe(false);
  });

  it('never retries writes', async () => {
    const fetch = vi.fn().mockResolvedValue(json(503, { error: 'Service unavailable' }));
    vi.stubGlobal('fetch', fetch);
    const { api } = await loadApi('https://api.example');

    await expect(api.archive('wo-1')).rejects.toThrow('Service unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('local development (no VITE_API_BASE_URL)', () => {
  it('reports an unreachable backend at once instead of waiting', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetch);
    const { api, serverWake } = await loadApi('');

    await expect(api.templates()).rejects.toThrow('Cannot reach the EvidenceLoop API');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(serverWake.isWaking()).toBe(false);
  });
});
