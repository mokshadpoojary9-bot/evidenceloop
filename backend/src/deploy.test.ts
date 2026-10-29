import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createEngine } from './agent/engine.js';
import { createApp } from './app.js';
import { parseCorsOrigins } from './config/cors.js';
import { checkPdf } from './media/selfCheck.js';
import { LocalFileStore } from './stores/fileStore.js';
import { LocalDb } from './stores/localDb.js';
import type { ReadinessReport, SystemStatus } from './types.js';

const SYSTEM: SystemStatus = {
  status: 'ok',
  ai: {
    mode: 'unconfigured',
    production: false,
    provider: 'none',
    model: null,
    message: '',
    live: { state: 'not_configured', vision: null, checkedAt: null, detail: null },
  },
  persistence: 'local',
  auth: 'disabled',
  maxUploadMb: 1,
};

function app(corsOrigins: string[], readiness?: () => Promise<ReadinessReport>) {
  const db = new LocalDb();
  return createApp({
    db,
    files: new LocalFileStore('unused'),
    engine: createEngine(db, null),
    ai: null,
    supabase: null,
    system: SYSTEM,
    corsOrigins,
    readiness,
  });
}

describe('CORS_ORIGIN', () => {
  it('splits a comma-separated list and drops whitespace, blanks and trailing slashes', () => {
    expect(parseCorsOrigins(' https://app.vercel.app/ ,http://localhost:5173,, http://localhost:5174 ')).toEqual([
      'https://app.vercel.app',
      'http://localhost:5173',
      'http://localhost:5174',
    ]);
  });

  it('answers the preflight for a listed origin and not for others', async () => {
    const api = request(app(['http://localhost:5173', 'https://app.vercel.app']));
    const preflight = (origin: string) =>
      api
        .options('/api/work-orders')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect((await preflight('https://app.vercel.app')).headers['access-control-allow-origin']).toBe('https://app.vercel.app');
    expect((await preflight('https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('GET /health/ping', () => {
  it('answers a keep-alive pinger with a tiny uncached reply, no auth or database needed', async () => {
    const res = await request(app([])).get('/health/ping');
    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('compression', () => {
  it('gzips JSON responses for clients that accept it', async () => {
    const res = await request(app([])).get('/api/templates').set('Accept-Encoding', 'gzip');
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(Array.isArray(res.body.templates)).toBe(true);
  });
});

describe('GET /api/health/ready', () => {
  const check = (ok: boolean) => ({ ok, detail: ok ? 'fine' : 'broken' });
  const report = (ok: boolean): ReadinessReport => ({
    ready: ok,
    checks: { database: check(true), storage: check(ok), video: check(true), pdf: check(true) },
  });

  it('is 200 when every check passes and 503 otherwise', async () => {
    const ready = await request(app([], async () => report(true))).get('/api/health/ready');
    expect(ready.status).toBe(200);
    const notReady = await request(app([], async () => report(false))).get('/api/health/ready');
    expect(notReady.status).toBe(503);
    expect((notReady.body as ReadinessReport).checks.storage).toEqual({ ok: false, detail: 'broken' });
  });

  it('is not mounted without a readiness probe', async () => {
    expect((await request(app([])).get('/api/health/ready')).status).toBe(404);
  });
});

describe('media self-check', () => {
  it('extracts the text of a generated PDF', async () => {
    expect(await checkPdf()).toEqual({ ok: true, detail: 'PDF text extraction works' });
  });
});
