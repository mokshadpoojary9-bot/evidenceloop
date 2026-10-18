// Where to send someone after sign-in. The address travels in `?next=` so it survives a
// reload and the email-confirmation round trip; it is only ever a same-site path.

export const NEXT_PARAM = 'next';
export const DEFAULT_RETURN = '/dashboard';

const BASE = 'http://evidenceloop.invalid';

/**
 * A same-site relative path (path + query + hash), or the fallback. Rejects absolute and
 * protocol-relative URLs, backslashes and control characters (browsers read `/\evil.com`
 * and `/<tab>/evil.com` as `//evil.com`), and the sign-in page itself.
 */
export function safeReturnPath(value: unknown, fallback = DEFAULT_RETURN): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE || url.pathname === '/login') return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The sign-in address that brings the user back to `location` afterwards. */
export function loginPath(location: { pathname: string; search: string; hash: string }): string {
  const here = `${location.pathname}${location.search}${location.hash}`;
  const next = safeReturnPath(here, '');
  return next ? `/login?${NEXT_PARAM}=${encodeURIComponent(next)}` : '/login';
}
