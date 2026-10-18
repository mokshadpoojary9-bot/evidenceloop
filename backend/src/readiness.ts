import type { SupabaseClient } from '@supabase/supabase-js';
import { checkMedia, type MediaReport } from './media/selfCheck.js';
import type { ReadinessCheck, ReadinessReport } from './types.js';

const CACHE_MS = 30_000;

async function checkDatabase(client: SupabaseClient): Promise<ReadinessCheck> {
  const { error } = await client.from('work_orders').select('id', { count: 'exact', head: true });
  return error ? { ok: false, detail: `query failed: ${error.message}` } : { ok: true, detail: 'Supabase database reachable' };
}

async function checkBucket(client: SupabaseClient, bucket: string): Promise<ReadinessCheck> {
  const { data, error } = await client.storage.getBucket(bucket);
  if (error || !data) return { ok: false, detail: `evidence bucket not found: ${error?.message ?? 'unknown error'}` };
  if (data.public) return { ok: false, detail: 'evidence bucket exists but is public; it must be private' };
  return { ok: true, detail: 'private evidence bucket exists' };
}

/**
 * Builds the readiness probe behind GET /api/health/ready. Results are cached for 30 s
 * (the media self-test runs once per process), so the public route cannot be used to
 * hammer Supabase.
 */
export function createReadiness(client: SupabaseClient | null, bucket: string) {
  let media: Promise<MediaReport> | null = null;
  let cached: { at: number; report: Promise<ReadinessReport> } | null = null;

  const run = async (): Promise<ReadinessReport> => {
    media ??= checkMedia();
    const local: ReadinessCheck = { ok: false, detail: 'local mode: Supabase is not configured' };
    const [database, storage, { video, pdf }] = await Promise.all([
      client ? checkDatabase(client).catch((e: Error) => ({ ok: false, detail: e.message })) : local,
      client ? checkBucket(client, bucket).catch((e: Error) => ({ ok: false, detail: e.message })) : local,
      media,
    ]);
    const checks = { database, storage, video, pdf };
    return { ready: Object.values(checks).every((check) => check.ok), checks };
  };

  return () => {
    if (!cached || Date.now() - cached.at > CACHE_MS) cached = { at: Date.now(), report: run() };
    return cached.report;
  };
}
