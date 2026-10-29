import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCache, fetchCached, prefetchCached, readCache, setCacheScope, writeCache } from './cache';

beforeEach(() => {
  setCacheScope(null);
  clearCache();
});

describe('page cache', () => {
  it('serves the last data per user, and forgets it on sign-out or when the user changes', async () => {
    setCacheScope('user-a');
    await fetchCached('dashboard', async () => ({ n: 1 }));
    expect(readCache('dashboard')).toEqual({ n: 1 });

    setCacheScope('user-b');
    expect(readCache('dashboard')).toBeUndefined();
    writeCache('dashboard', { n: 2 });
    clearCache(); // sign-out
    expect(readCache('dashboard')).toBeUndefined();
    expect(Object.keys(sessionStorage).some((key) => key.startsWith('evidenceloop.cache:'))).toBe(false);
  });

  it('caches nothing before anyone is signed in', async () => {
    await fetchCached('dashboard', async () => ({ n: 1 }));
    expect(readCache('dashboard')).toBeUndefined();
  });

  it('lets the page take over a pending prefetch once, then always asks the server', async () => {
    setCacheScope('user-a');
    let resolve!: (value: { n: number }) => void;
    const prefetch = vi.fn(() => new Promise<{ n: number }>((r) => (resolve = r)));
    prefetchCached('dashboard', prefetch);

    const fresh = vi.fn(async () => ({ n: 2 }));
    const first = fetchCached('dashboard', fresh);
    resolve({ n: 1 });
    expect(await first).toEqual({ n: 1 });
    expect(fresh).not.toHaveBeenCalled();

    expect(await fetchCached('dashboard', fresh)).toEqual({ n: 2 });
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(readCache('dashboard')).toEqual({ n: 2 });
  });

  it('does not store an answer that arrives after the user changed', async () => {
    setCacheScope('user-a');
    let resolve!: (value: { n: number }) => void;
    const late = fetchCached('dashboard', () => new Promise<{ n: number }>((r) => (resolve = r)));
    setCacheScope('user-b');
    resolve({ n: 1 });
    await late;
    expect(readCache('dashboard')).toBeUndefined();
  });
});
