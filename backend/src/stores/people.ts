import type { SupabaseClient } from '@supabase/supabase-js';
import { LOCAL_DEV_USER, LOCAL_REVIEWER } from '../middleware/auth.js';
import { ROLES, type Role } from '../types.js';
import type { Db } from './db.js';

/** Who someone is, for the reviewer's pages. Only reviewers are shown names. */
export interface Person {
  name: string;
  role: Role;
}

export interface People {
  get(id: string): Promise<Person>;
}

const CACHE_MS = 10 * 60_000;

/**
 * Names come from Supabase Auth (the Google name, else the email address); roles from
 * public.user_roles (no row = technician). Without Supabase, the two local demo users.
 */
export function createPeople(supabase: SupabaseClient | null, db: Db): People {
  const cache = new Map<string, { person: Person; until: number }>();

  const role = async (id: string): Promise<Role> => {
    if (!supabase) return id === LOCAL_REVIEWER.id ? 'reviewer' : 'technician';
    const assigned = await db.get('user_roles', id);
    return assigned && (ROLES as readonly string[]).includes(assigned.role) ? assigned.role : 'technician';
  };

  const name = async (id: string): Promise<string> => {
    if (!supabase) {
      if (id === LOCAL_REVIEWER.id) return 'Demo reviewer';
      if (id === LOCAL_DEV_USER.id) return 'Demo technician';
      return 'Technician';
    }
    const { data } = await supabase.auth.admin.getUserById(id);
    const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    const full = [meta.full_name, meta.name].find((value): value is string => typeof value === 'string' && value.trim() !== '');
    return full ?? data.user?.email ?? 'Unknown user';
  };

  return {
    async get(id) {
      const hit = cache.get(id);
      if (hit && hit.until > Date.now()) return hit.person;
      const person = { name: await name(id), role: await role(id) };
      cache.set(id, { person, until: Date.now() + CACHE_MS });
      return person;
    },
  };
}
