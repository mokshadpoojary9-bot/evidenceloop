import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestHandler, Response } from 'express';
import { HttpError } from './errors.js';

export interface AuthUser {
  id: string;
  email: string | null;
}

/** Stand-in user for local development when Supabase Auth is not configured. */
export const LOCAL_DEV_USER: AuthUser = {
  id: '00000000-0000-4000-8000-000000000000',
  email: 'local-dev@evidenceloop.invalid',
};

/**
 * With Supabase configured, every request must carry a valid Supabase access
 * token, which is verified with Supabase Auth. Without Supabase (local
 * development only) all requests act as a fixed local user.
 */
export function createAuth(supabase: SupabaseClient | null): RequestHandler {
  return async (req, res, next) => {
    if (!supabase) {
      res.locals.user = LOCAL_DEV_USER;
      return next();
    }

    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) throw new HttpError(401, 'Sign in required', 'UNAUTHENTICATED');

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, 'Session is invalid or expired', 'UNAUTHENTICATED');

    res.locals.user = { id: data.user.id, email: data.user.email ?? null } satisfies AuthUser;
    next();
  };
}

export const currentUser = (res: Response): AuthUser => res.locals.user as AuthUser;
