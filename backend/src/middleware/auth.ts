import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestHandler, Response } from 'express';
import type { Db } from '../stores/db.js';
import { ROLES, type Role, type Viewer } from '../types.js';
import { HttpError } from './errors.js';

export interface AuthUser {
  id: string;
  email: string | null;
  role: Role;
  roleSource: Viewer['roleSource'];
}

/** Stand-in technician for local development when Supabase Auth is not configured. */
export const LOCAL_DEV_USER: AuthUser = {
  id: '00000000-0000-4000-8000-000000000000',
  email: 'local-technician@evidenceloop.invalid',
  role: 'technician',
  roleSource: 'demo',
};

/** Stand-in reviewer for the local role switcher. A different id, so audit actors differ. */
export const LOCAL_REVIEWER: AuthUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'local-reviewer@evidenceloop.invalid',
  role: 'reviewer',
  roleSource: 'demo',
};

/** Header the local role switcher sends. Ignored whenever Supabase Auth is configured. */
export const DEMO_ROLE_HEADER = 'x-demo-role';

/**
 * With Supabase configured, every request must carry a valid Supabase access
 * token, verified with Supabase Auth; the role comes from public.user_roles,
 * which only an administrator can write (no row = technician). Without Supabase
 * (local development only) requests act as a fixed local user, and the demo
 * role switcher picks which one.
 */
export function createAuth(supabase: SupabaseClient | null, db: Db): RequestHandler {
  return async (req, res, next) => {
    if (!supabase) {
      const requested = req.header(DEMO_ROLE_HEADER);
      res.locals.user = requested === 'reviewer' ? LOCAL_REVIEWER : LOCAL_DEV_USER;
      return next();
    }

    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) throw new HttpError(401, 'Sign in required', 'UNAUTHENTICATED');

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, 'Session is invalid or expired', 'UNAUTHENTICATED');

    const assigned = await db.get('user_roles', data.user.id);
    const role: Role = assigned && (ROLES as readonly string[]).includes(assigned.role) ? assigned.role : 'technician';
    res.locals.user = { id: data.user.id, email: data.user.email ?? null, role, roleSource: 'supabase' } satisfies AuthUser;
    next();
  };
}

export const currentUser = (res: Response): AuthUser => res.locals.user as AuthUser;
