// npm run seed:demo                     — create the three demo work orders (skips any that exist)
// npm run seed:demo -- --reset          — remove the three demo work orders, nothing else
// npm run seed:demo -- --owner <email>  — Supabase mode: the technician account that owns them
//                                         (or set DEMO_OWNER_EMAIL)
//
// Uses the same database and storage as the API: Supabase when configured, otherwise
// backend/.data/. Results come from the DEV ONLY fixture and are labelled simulated;
// no Nebius request is made.

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { env } from '../config/env.js';
import { supabase } from '../lib/supabase.js';
import { LOCAL_DEV_USER, type AuthUser } from '../middleware/auth.js';
import { resetDemo, seedDemo } from '../demo/seedDemo.js';
import { LocalFileStore, SupabaseFileStore } from '../stores/fileStore.js';
import { LocalDb } from '../stores/localDb.js';
import { SupabaseDb } from '../stores/supabaseDb.js';

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const ownerFlag = args.findIndex((arg) => arg === '--owner' || arg.startsWith('--owner='));
const ownerEmail =
  ownerFlag === -1
    ? process.env.DEMO_OWNER_EMAIL?.trim() || null
    : args[ownerFlag]!.includes('=')
      ? args[ownerFlag]!.split('=')[1]!
      : (args[ownerFlag + 1] ?? null);

const demoDir = fileURLToPath(new URL('../../../demo', import.meta.url));

class SeedError extends Error {}

/** Throws instead of exiting, so open network handles close normally (process.exit can crash on Windows). */
function fail(message: string): never {
  throw new SeedError(message);
}

async function findOwner(): Promise<AuthUser> {
  if (!supabase) return LOCAL_DEV_USER;
  if (!ownerEmail) {
    fail('Supabase is configured, so the demo needs an owner. Pass --owner <email> (an existing technician account) or set DEMO_OWNER_EMAIL.');
  }
  const wanted = ownerEmail.toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`could not list Supabase users: ${error.message}`);
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === wanted);
    if (user) {
      const { data: role } = await supabase.from('user_roles').select('role').eq('id', user.id).maybeSingle();
      if (role?.role === 'reviewer') fail('that account is a reviewer. Demo work orders must be owned by a technician.');
      return { id: user.id, email: user.email ?? null, role: 'technician', roleSource: 'supabase' };
    }
    if (data.users.length < 200) fail('no Supabase account has that email. Sign up in the app first.');
  }
}

/** The local store is a JSON file the running API keeps in memory, so both must not write at once. */
async function assertLocalApiStopped() {
  try {
    await fetch(`http://localhost:${env.PORT}/api/health`, { signal: AbortSignal.timeout(1000) });
  } catch {
    return;
  }
  fail(`the API is running on port ${env.PORT}. In local mode, stop it first (it would overwrite the seeded data), then start it again.`);
}

const db = supabase ? new SupabaseDb(supabase) : new LocalDb(join(env.LOCAL_DATA_DIR, 'db.json'));
const files = supabase
  ? new SupabaseFileStore(supabase, env.SUPABASE_STORAGE_BUCKET)
  : new LocalFileStore(join(env.LOCAL_DATA_DIR, 'uploads'));

try {
  if (env.NODE_ENV === 'production') fail('refusing to run with NODE_ENV=production: demo data uses the DEV ONLY fixture.');
  if (!supabase) await assertLocalApiStopped();
  console.log(`seed:demo — persistence: ${supabase ? 'supabase' : `local (${env.LOCAL_DATA_DIR}/)`}`);

  if (reset) {
    const removed = await resetDemo({ db, files, log: console.log });
    console.log(removed.length ? `Removed ${removed.length} demo work order(s).` : 'No demo work orders to remove.');
  } else {
    const owner = await findOwner();
    const { created, skipped } = await seedDemo({ db, files, owner, demoDir, log: console.log });
    console.log(
      `Created ${created.length}, already present ${skipped.length}. ` +
        'Results are simulated by the DEV fixture — run verification in the app for a real Nemotron result.',
    );
    if (skipped.length) console.log('To rebuild them: npm run seed:demo -- --reset, then npm run seed:demo.');
  }
} catch (error) {
  console.error(`seed:demo — ${error instanceof Error ? error.message : String(error)}`);
  if (!(error instanceof SeedError) && error instanceof Error && error.stack) console.error(error.stack);
  process.exitCode = 1;
}
