import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db } from './db.js';
import { type FileStore, LocalFileStore, SupabaseFileStore } from './fileStore.js';
import { LocalDb } from './localDb.js';
import { SupabaseDb } from './supabaseDb.js';

export interface Stores {
  db: Db;
  files: FileStore;
  persistence: 'supabase' | 'local';
}

/**
 * Where everything is saved. With Supabase: every table in Postgres and every evidence file
 * in Storage, so nothing is lost on reload, sign-out or a server restart. The local store
 * (a JSON file and an uploads folder on this machine's disk) is for development only, and
 * production refuses it even if the environment check were bypassed.
 */
export function selectStores(options: {
  nodeEnv: string;
  supabase: SupabaseClient | null;
  bucket: string;
  localDataDir: string;
}): Stores {
  const { nodeEnv, supabase, bucket, localDataDir } = options;
  if (supabase) {
    return { db: new SupabaseDb(supabase), files: new SupabaseFileStore(supabase, bucket), persistence: 'supabase' };
  }
  if (nodeEnv === 'production') {
    throw new Error('Production requires Supabase: the local store would lose data on every restart.');
  }
  return {
    db: new LocalDb(join(localDataDir, 'db.json')),
    files: new LocalFileStore(join(localDataDir, 'uploads')),
    persistence: 'local',
  };
}
