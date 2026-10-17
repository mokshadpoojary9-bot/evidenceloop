import type { SupabaseClient } from '@supabase/supabase-js';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { LocalDb } from '../stores/localDb.js';
import { createAuth, currentUser } from './auth.js';
import { errorHandler } from './errors.js';

const TECH = '11111111-1111-4111-8111-111111111111';
const REVIEWER = '22222222-2222-4222-8222-222222222222';

/** Stands in for Supabase Auth: the token is the user id. */
const fakeSupabase = {
  auth: {
    getUser: async (token: string) =>
      [TECH, REVIEWER].includes(token)
        ? { data: { user: { id: token, email: `${token.slice(0, 4)}@example.com` } }, error: null }
        : { data: { user: null }, error: new Error('invalid') },
  },
} as unknown as SupabaseClient;

async function app() {
  const db = new LocalDb();
  await db.insert('user_roles', { id: REVIEWER, role: 'reviewer' });
  const server = express();
  server.get('/me', createAuth(fakeSupabase, db), (_req, res) => res.json(currentUser(res)));
  server.use(errorHandler);
  return request(server);
}

describe('auth with Supabase configured', () => {
  it('takes the role from public.user_roles, defaulting to technician', async () => {
    const api = await app();
    expect((await api.get('/me').set('Authorization', `Bearer ${TECH}`)).body).toMatchObject({ id: TECH, role: 'technician', roleSource: 'supabase' });
    expect((await api.get('/me').set('Authorization', `Bearer ${REVIEWER}`)).body).toMatchObject({ role: 'reviewer' });
  });

  it('ignores the local demo role header', async () => {
    const api = await app();
    const res = await api.get('/me').set('Authorization', `Bearer ${TECH}`).set('X-Demo-Role', 'reviewer');
    expect(res.body.role).toBe('technician');
  });

  it('requires a valid session', async () => {
    const api = await app();
    expect((await api.get('/me')).status).toBe(401);
    expect((await api.get('/me').set('Authorization', 'Bearer nope')).status).toBe(401);
  });
});
