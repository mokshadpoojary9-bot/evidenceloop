import { join } from 'node:path';
import { createEngine } from './agent/engine.js';
import { createAiProvider, describeAi, verifyLiveAi } from './ai/index.js';
import { createApp } from './app.js';
import { corsOrigins, env } from './config/env.js';
import { supabase } from './lib/supabase.js';
import { LocalFileStore, SupabaseFileStore } from './stores/fileStore.js';
import { LocalDb } from './stores/localDb.js';
import { SupabaseDb } from './stores/supabaseDb.js';
import type { SystemStatus } from './types.js';

const db = supabase ? new SupabaseDb(supabase) : new LocalDb(join(env.LOCAL_DATA_DIR, 'db.json'));
const files = supabase
  ? new SupabaseFileStore(supabase, env.SUPABASE_STORAGE_BUCKET)
  : new LocalFileStore(join(env.LOCAL_DATA_DIR, 'uploads'));

const system: SystemStatus = {
  status: 'ok',
  ai: describeAi(),
  persistence: supabase ? 'supabase' : 'local',
  auth: supabase ? 'supabase' : 'disabled',
  maxUploadMb: env.MAX_UPLOAD_MB,
};

const engine = createEngine(db, createAiProvider(files));
const app = createApp({ db, files, engine, supabase, system, corsOrigins });

app.listen(env.PORT, () => {
  // Startup log reports modes only. Keys and URLs are never printed.
  console.log(`EvidenceLoop API listening on http://localhost:${env.PORT}`);
  console.log(`  persistence: ${system.persistence}${supabase ? '' : ` (${env.LOCAL_DATA_DIR}/, no auth — local development only)`}`);
  console.log(`  ai:          ${system.ai.mode} — ${system.ai.message}`);
});

// Live connection test: the dashboard only reports Nemotron as connected after this passes.
if (system.ai.mode === 'nebius') {
  void verifyLiveAi(system.ai).then(
    () => console.log(`  ai live test: ${system.ai.live.state}${system.ai.live.detail ? ` — ${system.ai.live.detail}` : ''}`),
    (error: unknown) => console.error('  ai live test crashed:', error instanceof Error ? error.message : error),
  );
}
