import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env.js';

// Secret-key client: bypasses Row Level Security. Server-side only — this key must
// never be sent to the browser, which uses the publishable key instead.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;
