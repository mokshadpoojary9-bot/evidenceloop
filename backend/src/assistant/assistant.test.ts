import type { SupabaseClient } from '@supabase/supabase-js';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createEngine } from '../agent/engine.js';
import { createApp } from '../app.js';
import { chatStream, NebiusError, type ChatMessage } from '../lib/nebius.js';
import { LOCAL_DEV_USER, LOCAL_REVIEWER, type AuthUser } from '../middleware/auth.js';
import { LocalFileStore } from '../stores/fileStore.js';
import { LocalDb } from '../stores/localDb.js';
import { createWorkOrder } from '../stores/writes.js';
import { TEMPLATES } from '../templates.js';
import type { SystemStatus, WorkOrderStatus } from '../types.js';
import { buildAssistantContext, MAX_CONTEXT_CHARS } from './context.js';
import { createRateLimiter } from './rateLimit.js';
import type { AssistantChat } from './verity.js';

const otherTechnician: AuthUser = { ...LOCAL_DEV_USER, id: '00000000-0000-4000-8000-0000000000bb', email: null };
const template = TEMPLATES[0]!;

async function seed() {
  const db = new LocalDb();
  const make = async (owner: AuthUser, title: string, status: WorkOrderStatus) => {
    const workOrder = await createWorkOrder(db, owner, {
      title,
      description: '',
      location: title.includes('204') ? 'Room 204' : 'Hall B',
      templateId: template.id,
      requirements: template.requirements,
    });
    await db.update('work_orders', workOrder.id, { status });
    return workOrder.id;
  };
  const mine = await make(LOCAL_DEV_USER, 'Replace emergency light in Room 204', 'NEEDS_EVIDENCE');
  const myDraft = await make(LOCAL_DEV_USER, 'Service exit sign', 'AWAITING_EVIDENCE');
  const theirs = await make(otherTechnician, 'Fix fire door closer', 'CONTRADICTED');
  const theirDraft = await make(otherTechnician, 'Inspect sprinkler valve', 'AWAITING_EVIDENCE');
  return { db, mine, myDraft, theirs, theirDraft };
}

describe('buildAssistantContext', () => {
  it("gives a technician only their own work orders, even when they name someone else's", async () => {
    const { db, mine, myDraft, theirs } = await seed();
    const context = await buildAssistantContext(db, LOCAL_DEV_USER, { question: 'What about the fire door closer?', workOrderId: theirs });
    expect(context.text).toContain('Replace emergency light in Room 204');
    expect(context.text).toContain('Service exit sign');
    expect(context.text).not.toContain('Fix fire door closer');
    expect(context.text).not.toContain('Inspect sprinkler valve');
    expect(new Set(context.scopeIds)).toEqual(new Set([mine, myDraft]));
    expect(context.text).toContain("Scope: this technician's own work orders (2)");
  });

  it('puts the work order the question is about first, with its requirements', async () => {
    const { db, mine } = await seed();
    const context = await buildAssistantContext(db, LOCAL_DEV_USER, { question: 'Why is Room 204 not verified?' });
    expect(context.detailedIds[0]).toBe(mine);
    expect(context.text).toMatch(/#1 .+: NOT_PROVEN/);
    expect(context.text).toContain('Evidence: none uploaded.');
  });

  it('gives a reviewer the review queue across technicians, not their drafts', async () => {
    const { db, mine, theirs, myDraft, theirDraft } = await seed();
    const context = await buildAssistantContext(db, LOCAL_REVIEWER, { question: 'What is in my queue?' });
    expect(context.text).toContain('Fix fire door closer'); // contradicted, another technician
    expect(context.scopeIds).toContain(theirs);
    expect(context.scopeIds).not.toContain(myDraft);
    expect(context.scopeIds).not.toContain(theirDraft);
    expect(context.text).not.toContain('Inspect sprinkler valve');
    // NEEDS_EVIDENCE without an uncertain requirement is not in the queue.
    expect(context.scopeIds).not.toContain(mine);
  });

  it('stays within the size budget', async () => {
    const { db } = await seed();
    for (let i = 0; i < 60; i++) {
      await createWorkOrder(db, LOCAL_DEV_USER, {
        title: `Bulk work order ${i} ${'x'.repeat(200)}`,
        description: '',
        location: '',
        templateId: template.id,
        requirements: template.requirements,
      });
    }
    const context = await buildAssistantContext(db, LOCAL_DEV_USER, { question: 'Summarize today' });
    expect(context.text.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  });
});

const SYSTEM: SystemStatus = {
  status: 'ok',
  ai: { mode: 'unconfigured', production: false, provider: 'none', model: null, message: '', live: { state: 'not_configured', vision: null, checkedAt: null, detail: null } },
  persistence: 'local',
  auth: 'supabase',
  maxUploadMb: 1,
};

/** Supabase Auth stand-in: the token "tech-token" is the local technician, anything else is refused. */
const fakeSupabase = {
  auth: {
    getUser: async (token: string) =>
      token === 'tech-token'
        ? { data: { user: { id: LOCAL_DEV_USER.id, email: 'tech@example.com' } }, error: null }
        : { data: { user: null }, error: { message: 'invalid' } },
  },
} as unknown as SupabaseClient;

function appWith(db: LocalDb, assistant: AssistantChat | null) {
  return request(
    createApp({ db, files: new LocalFileStore('unused'), engine: createEngine(db, null), ai: null, supabase: fakeSupabase, system: SYSTEM, corsOrigins: [], assistant }),
  );
}

const ask = (api: ReturnType<typeof appWith>, question: string, token = 'tech-token') =>
  api.post('/api/assistant').set('Authorization', `Bearer ${token}`).send({ messages: [{ role: 'user', content: question }] });

describe('POST /api/assistant', () => {
  it('requires a signed-in user', async () => {
    const { db } = await seed();
    const chat = vi.fn();
    const api = appWith(db, chat);
    expect((await api.post('/api/assistant').send({ messages: [{ role: 'user', content: 'hi' }] })).status).toBe(401);
    expect((await ask(api, 'hi', 'forged')).status).toBe(401);
    expect(chat).not.toHaveBeenCalled();
  });

  it("streams Verity's answer, built from the user's own data only", async () => {
    const { db } = await seed();
    let prompt: ChatMessage[] = [];
    const chat: AssistantChat = async function* (messages) {
      prompt = messages;
      yield 'Room 204 is ';
      yield 'not verified yet.';
    };
    const res = await ask(appWith(db, chat), 'Why is Room 204 not verified?');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/x-ndjson/);
    const lines = res.text.trim().split('\n').map((line) => JSON.parse(line) as { type: string; text?: string });
    expect(lines.map((line) => line.text ?? line.type).join('')).toBe('Room 204 is not verified yet.done');
    const system = String(prompt[0]!.content);
    expect(system).toContain('You are Verity');
    expect(system).toContain('Replace emergency light in Room 204');
    expect(system).not.toContain('Fix fire door closer');
    expect(prompt.at(-1)).toEqual({ role: 'user', content: 'Why is Room 204 not verified?' });
  });

  it('explains Nebius 401 and 429 clearly, and says when the assistant is not configured', async () => {
    const { db } = await seed();
    const failing = (error: NebiusError): AssistantChat =>
      async function* () {
        yield* [];
        throw error;
      };
    const unauthorized = await ask(appWith(db, failing(new NebiusError('no', 'UNAUTHORIZED', 401))), 'hi');
    expect(unauthorized.status).toBe(502);
    expect(unauthorized.body.error).toMatch(/rejected the server key \(401\)/);
    const limited = await ask(appWith(db, failing(new NebiusError('slow down', 'RATE_LIMITED', 429))), 'hi');
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatch(/busy/);
    const none = await ask(appWith(db, null), 'hi');
    expect(none.status).toBe(503);
    expect(none.body.code).toBe('ASSISTANT_NOT_CONFIGURED');
  });

  it('rate-limits each user', async () => {
    const { db } = await seed();
    const api = appWith(db, async function* () {
      yield 'ok';
    });
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) statuses.push((await ask(api, `question ${i}`)).status);
    expect(statuses.slice(0, 8).every((status) => status === 200)).toBe(true);
    expect(statuses[8]).toBe(429);
  });

  it('rejects a conversation that does not end with a question', async () => {
    const { db } = await seed();
    const res = await appWith(db, vi.fn())
      .post('/api/assistant')
      .set('Authorization', 'Bearer tech-token')
      .send({ messages: [{ role: 'assistant', content: 'hello' }] });
    expect(res.status).toBe(400);
  });
});

describe('createRateLimiter', () => {
  it('allows a burst per minute and a daily total, per user', () => {
    const limiter = createRateLimiter({ perMinute: 2, perDay: 3 });
    expect([limiter.take('a', 0), limiter.take('a', 1), limiter.take('a', 2)].map((wait) => wait > 0)).toEqual([false, false, true]);
    expect(limiter.take('b', 2)).toBe(0);
    expect(limiter.take('a', 61_000)).toBe(0);
    expect(limiter.take('a', 122_000)).toBeGreaterThan(0); // daily total reached
  });
});

describe('chatStream', () => {
  const sse = (...events: string[]) =>
    new Response(new Blob([events.map((event) => `data: ${event}\n\n`).join('')]).stream(), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  const delta = (content: string) => JSON.stringify({ choices: [{ delta: { content } }] });
  const config = { apiKey: 'test', baseUrl: 'https://nebius.test/v1', model: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B' };

  it('yields content deltas, drops any reasoning trace, and sends thinking off', async () => {
    const fetch = vi.fn(async () => sse(delta('<think>hidden'), delta(' plan</think>Room '), delta('204'), '[DONE]'));
    const parts: string[] = [];
    for await (const part of chatStream(config, [{ role: 'user', content: 'q' }], {}, { fetch })) parts.push(part);
    expect(parts.join('')).toBe('Room 204');
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ model: config.model, stream: true, chat_template_kwargs: { enable_thinking: false } });
  });

  it('turns a 429 into a rate-limit error before streaming', async () => {
    const fetch = vi.fn(async () => new Response('too many', { status: 429 }));
    await expect(chatStream(config, [], {}, { fetch }).next()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
