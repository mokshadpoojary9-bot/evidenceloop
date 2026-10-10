import { z } from 'zod';
import type { AiMode } from '../types.js';

// Load backend/.env when present; in production the host provides real env vars.
try {
  process.loadEnvFile();
} catch {
  // no .env file
}

// Treat blank values (e.g. an unfilled .env.example line) as unset.
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(blankToUndefined, z.string().trim().optional());
const flag = z.preprocess(blankToUndefined, z.enum(['true', 'false']).default('false'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.preprocess(blankToUndefined, z.string().default('http://localhost:5173')),
  MAX_UPLOAD_MB: z.preprocess(blankToUndefined, z.coerce.number().positive().default(50)),
  LOCAL_DATA_DIR: z.preprocess(blankToUndefined, z.string().default('.data')),

  SUPABASE_URL: z.preprocess(blankToUndefined, z.url().optional()),
  SUPABASE_SECRET_KEY: optionalString,
  SUPABASE_STORAGE_BUCKET: z.preprocess(blankToUndefined, z.string().default('evidence')),

  NEBIUS_API_KEY: optionalString,
  NEBIUS_BASE_URL: z.preprocess(
    blankToUndefined,
    z.url().default('https://api.tokenfactory.nebius.com/v1'),
  ),
  NEBIUS_MODEL: optionalString,

  // DEV ONLY. Enables the deterministic fixture that stands in for AI while no Nebius key exists.
  DEV_FIXTURE_AI: flag,
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // prettifyError lists variable names and rules only — never the values.
  console.error('Invalid environment configuration:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;

export const corsOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim());

export const isSupabaseConfigured = Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY);
export const isNebiusConfigured = Boolean(env.NEBIUS_API_KEY && env.NEBIUS_MODEL);

// Without Supabase the API has no authentication and stores data on local disk.
// That is acceptable on a developer machine and nowhere else.
if (env.NODE_ENV === 'production' && !isSupabaseConfigured) {
  console.error(
    'Refusing to start: NODE_ENV=production requires SUPABASE_URL and SUPABASE_SECRET_KEY. ' +
      'The unauthenticated local store is for development only.',
  );
  process.exit(1);
}

if (env.DEV_FIXTURE_AI === 'true' && env.NODE_ENV === 'production') {
  console.warn('DEV_FIXTURE_AI is ignored because NODE_ENV=production.');
}

/**
 * Nebius always wins when configured. The fixture can never run in production,
 * so a production deployment without Nebius has no AI at all rather than a fake one.
 */
export const aiMode: AiMode = isNebiusConfigured
  ? 'nebius'
  : env.DEV_FIXTURE_AI === 'true' && env.NODE_ENV !== 'production'
    ? 'dev-fixture'
    : 'unconfigured';
