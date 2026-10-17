import { env } from '../config/env.js';
import { supabase } from '../lib/supabase.js';
import { TABLE_NAMES, type TableName, type Tables } from '../stores/db.js';
import { toSnake } from '../stores/supabaseDb.js';

// Verifies the backend's Supabase project: `npm run check:supabase`.
// Prints pass/fail per check and never prints a key or any row content.

// Every column the backend reads or writes, named by the domain field it maps to.
const COLUMNS: { [T in TableName]: (keyof Tables[T] & string)[] } = {
  work_orders: [
    'id', 'ownerId', 'title', 'description', 'location', 'templateId', 'status', 'simulated',
    'archivedAt', 'createdAt', 'updatedAt',
  ],
  requirements: [
    'id', 'workOrderId', 'position', 'title', 'description', 'mandatory', 'evidenceNeeds', 'status',
    'currentAssessmentId', 'updatedAt',
  ],
  evidence: [
    'id', 'workOrderId', 'kind', 'fileName', 'mimeType', 'sizeBytes', 'sha256', 'storagePath', 'note',
    'requestId', 'uploadedBy', 'createdAt',
  ],
  assessments: [
    'id', 'workOrderId', 'requirementId', 'runId', 'status', 'reasoning', 'confidence', 'observations',
    'missingEvidence', 'policyNotes', 'provider', 'model', 'simulated', 'createdAt',
  ],
  analysis_runs: [
    'id', 'workOrderId', 'trigger', 'triggerEvidenceId', 'requirementIds', 'provider', 'model', 'simulated',
    'status', 'error', 'startedAt', 'completedAt',
  ],
  evidence_requests: [
    'id', 'workOrderId', 'runId', 'requestedBy', 'requirementIds', 'kind', 'instruction', 'status',
    'fulfilledByEvidenceId', 'createdAt', 'updatedAt',
  ],
  audit_events: ['id', 'workOrderId', 'runId', 'actor', 'type', 'summary', 'data', 'createdAt'],
  reviews: [
    'id', 'workOrderId', 'status', 'statusAtSubmission', 'submittedBy', 'submissionNote', 'submittedAt',
    'reviewerId', 'decisionNote', 'decidedAt',
  ],
  user_roles: ['id', 'role'],
};

// The dashboard subscribes to these (frontend/src/hooks.ts).
const REALTIME_TABLES: TableName[] = ['work_orders', 'requirements', 'evidence_requests', 'audit_events', 'reviews'];

interface SchemaReport {
  rls: Record<string, boolean>;
  policies: Record<string, number>;
  realtime: string[];
  reviewTrigger: boolean;
}

const RERUN = 'run supabase/schema.sql in the Supabase SQL editor';

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

// Connection: a secret key can list users; a publishable key pasted by mistake cannot.
const users = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
report(!users.error, 'Secret key accepted by Supabase Auth (admin access)', users.error?.message);

// Auth: sign-up by email, and new accounts must confirm their address before signing in.
try {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: env.SUPABASE_SECRET_KEY! },
  });
  const settings = (await response.json()) as {
    disable_signup?: boolean;
    mailer_autoconfirm?: boolean;
    external?: { email?: boolean };
  };
  const hint = (ok: boolean, where: string) => (ok ? '' : `Authentication → Sign In / Providers → ${where}`);
  const email = settings.external?.email === true;
  const signups = settings.disable_signup !== true;
  report(email, 'Auth: email provider enabled', hint(email, 'Email'));
  report(signups, 'Auth: sign-ups allowed', hint(signups, 'Allow new users to sign up'));
  report(
    settings.mailer_autoconfirm === false,
    'Auth: new users must confirm their email',
    hint(settings.mailer_autoconfirm === false, 'Email → enable "Confirm email"'),
  );
} catch (error) {
  report(false, 'Auth settings readable', error instanceof Error ? error.message : String(error));
}

// Tables and columns: selecting a missing column fails with its name. (Not a HEAD request:
// supabase-js reports no error for a HEAD 404, so a missing table would look present.)
for (const table of TABLE_NAMES) {
  const { error } = await supabase.from(table).select('id').limit(0);
  if (error) {
    report(false, `Table public.${table}`, `${error.message} (${RERUN})`);
    continue;
  }
  const columns = COLUMNS[table].map(toSnake);
  const probe = await supabase.from(table).select(columns.join(',')).limit(0);
  report(
    !probe.error,
    `Table public.${table} (${columns.length} columns)`,
    probe.error ? `${probe.error.message} (${RERUN})` : '',
  );
}

// Row Level Security, policies, Realtime and the review trigger: read from the catalog.
const { data, error } = await supabase.rpc('evidenceloop_schema_report');
if (error) {
  report(false, 'Schema report available', `${error.message} (${RERUN})`);
} else {
  const schema = data as SchemaReport;
  for (const table of TABLE_NAMES) {
    report(schema.rls[table] === true, `RLS enabled on public.${table}`, schema.rls[table] ? '' : RERUN);
  }
  for (const table of TABLE_NAMES) {
    const count = schema.policies[table] ?? 0;
    report(count > 0, `Read policies on public.${table}`, count > 0 ? `${count}` : RERUN);
  }
  for (const table of REALTIME_TABLES) {
    report(schema.realtime.includes(table), `Realtime publishes public.${table}`, schema.realtime.includes(table) ? '' : RERUN);
  }
  report(schema.reviewTrigger, 'Review role trigger installed (reviews_enforce_roles)', schema.reviewTrigger ? '' : RERUN);
}

// Storage.
const bucket = await supabase.storage.getBucket(env.SUPABASE_STORAGE_BUCKET);
report(!bucket.error, `Storage bucket "${env.SUPABASE_STORAGE_BUCKET}" exists`, bucket.error?.message);
if (bucket.data) report(!bucket.data.public, 'Storage bucket is private', bucket.data.public ? 'make it private in Storage → bucket settings' : '');

console.log(failed ? '\nSupabase check FAILED.' : '\nSupabase check passed.');
process.exit(failed ? 1 : 0);
