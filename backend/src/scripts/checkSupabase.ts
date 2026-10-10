import { env } from '../config/env.js';
import { supabase } from '../lib/supabase.js';
import { TABLE_NAMES } from '../stores/db.js';

// Verifies the backend's Supabase connection: `npm run check:supabase`.
// Prints pass/fail per check and never prints a key or any row content.

let failed = false;
const report = (ok: boolean, label: string, detail = '') => {
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log(`SUPABASE_URL          ${env.SUPABASE_URL ? 'set' : 'MISSING'}`);
console.log(`SUPABASE_SECRET_KEY   ${env.SUPABASE_SECRET_KEY ? 'set' : 'MISSING'}`);

if (!supabase) {
  console.log('\nFAIL  Supabase is not configured. Set both values in backend/.env and run again.');
  process.exit(1);
}

// A secret key can list users; a publishable key pasted by mistake cannot.
const users = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
report(!users.error, 'Secret key accepted by Supabase Auth (admin access)', users.error?.message);

for (const table of TABLE_NAMES) {
  const { error } = await supabase.from(table).select('id', { head: true, count: 'exact' });
  report(!error, `Table public.${table}`, error ? `${error.message} (run supabase/schema.sql)` : '');
}

const bucket = await supabase.storage.getBucket(env.SUPABASE_STORAGE_BUCKET);
report(!bucket.error, `Storage bucket "${env.SUPABASE_STORAGE_BUCKET}" exists`, bucket.error?.message);
if (bucket.data) report(!bucket.data.public, 'Storage bucket is private');

console.log(failed ? '\nSupabase check FAILED.' : '\nSupabase check passed.');
process.exit(failed ? 1 : 0);
