import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * Browser Supabase client, used for sign-in and Realtime only. It holds the
 * PUBLISHABLE key, so everything it can read is limited by Row Level Security.
 * Null when Supabase is not configured (local development without sign-in).
 */
export const supabase: SupabaseClient | null =
  url && publishableKey ? createClient(url, publishableKey) : null;
