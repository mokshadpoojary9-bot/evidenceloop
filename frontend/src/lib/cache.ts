// Stale-while-revalidate for page data: a revisit shows the last data at once, then the page
// refreshes it in the background. Entries are scoped to the signed-in user and kept in memory
// and in sessionStorage (this tab only, gone when it closes). Signing out clears everything.

const PREFIX = 'evidenceloop.cache:';

let scope: string | null = null;
const memory = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Whose data is cached: the user id (or the local demo role). A change drops the old entries. */
export function setCacheScope(next: string | null) {
  if (next === scope) return;
  if (scope !== null) clearCache();
  scope = next;
}

/** Forgets every cached page, in memory and in this tab's storage. */
export function clearCache() {
  memory.clear();
  inflight.clear();
  const store = storage();
  if (!store) return;
  try {
    for (const key of Object.keys(store)) if (key.startsWith(PREFIX)) store.removeItem(key);
  } catch {
    // storage unavailable: memory is already cleared
  }
}

const fullKey = (key: string) => (scope === null ? null : `${PREFIX}${scope}:${key}`);

/** The last data stored under `key` for the current user, if any. */
export function readCache<T>(key: string): T | undefined {
  const full = fullKey(key);
  if (!full) return undefined;
  if (memory.has(full)) return memory.get(full) as T;
  try {
    const raw = storage()?.getItem(full);
    if (raw) {
      const value = JSON.parse(raw) as T;
      memory.set(full, value);
      return value;
    }
  } catch {
    // unreadable entry: treat as a miss
  }
  return undefined;
}

export function writeCache(key: string, value: unknown) {
  const full = fullKey(key);
  if (!full) return;
  memory.set(full, value);
  try {
    storage()?.setItem(full, JSON.stringify(value));
  } catch {
    // quota or storage unavailable: the memory copy still serves this visit
  }
}

/** Fetches fresh data and stores it, unless a scope change happened meanwhile. */
function load<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const owner = scope;
  return fetcher().then((value) => {
    if (scope === owner) writeCache(key, value);
    return value;
  });
}

/**
 * Fresh data for a page, stored for the next visit. The first call after a prefetch takes
 * over the prefetched request instead of asking again; every later call asks the server,
 * so a refresh after a change never gets an answer from before it.
 */
export function fetchCached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const full = fullKey(key) ?? key;
  const prefetched = inflight.get(full) as Promise<T> | undefined;
  if (prefetched) {
    inflight.delete(full);
    return prefetched;
  }
  return load(key, fetcher);
}

/** Starts loading `key` ahead of the page that will need it. */
export function prefetchCached<T>(key: string, fetcher: () => Promise<T>) {
  const full = fullKey(key) ?? key;
  if (inflight.has(full)) return;
  const promise = load(key, fetcher);
  inflight.set(full, promise);
  // Only shared while pending: once settled, the data is in the cache (or, after a failure,
  // the page simply asks again), and a later visit must not reuse an old answer.
  const settle = () => {
    if (inflight.get(full) === promise) inflight.delete(full);
  };
  promise.then(settle, settle);
}
