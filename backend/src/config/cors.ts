/**
 * CORS_ORIGIN is comma-separated, e.g. `http://localhost:5173,https://app.vercel.app`.
 * Trailing slashes are dropped: browsers send the Origin header without one.
 */
export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}
