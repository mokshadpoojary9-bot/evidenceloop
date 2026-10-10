import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createEngine } from './agent/engine.js';
import { DevFixtureProvider } from './ai/devFixtureProvider.js';
import type { AiProvider } from './ai/provider.js';
import { createApp } from './app.js';
import { LocalFileStore } from './stores/fileStore.js';
import { LocalDb } from './stores/localDb.js';
import {
  CANNOT_VERIFY,
  type EvidenceKind,
  type SystemStatus,
  type WorkOrderDetail,
} from './types.js';

const uploadDir = mkdtempSync(join(tmpdir(), 'evidenceloop-test-'));
afterAll(() => rmSync(uploadDir, { recursive: true, force: true }));

const MIME: Record<EvidenceKind, string> = {
  before_photo: 'image/jpeg',
  after_photo: 'image/jpeg',
  additional_photo: 'image/png',
  video: 'video/mp4',
  document: 'application/pdf',
  audio: 'audio/mpeg',
  transcript: 'text/plain',
};

function setup(provider: AiProvider | null) {
  const db = new LocalDb();
  const files = new LocalFileStore(uploadDir);
  const engine = createEngine(db, provider);
  const system: SystemStatus = {
    status: 'ok',
    ai: { mode: 'unconfigured', production: false, provider: 'none', model: null, message: '' },
    persistence: 'local',
    auth: 'disabled',
    maxUploadMb: 1,
  };
  const app = createApp({ db, files, engine, supabase: null, system, corsOrigins: [] });
  const api = request(app);

  const create = async () => {
    const res = await api
      .post('/api/work-orders')
      .send({ title: 'Replace emergency light in Room 204', templateId: 'emergency-light-replacement' });
    expect(res.status).toBe(201);
    return (res.body as WorkOrderDetail).workOrder.id;
  };
  const upload = (id: string, kind: EvidenceKind, note = '') =>
    api
      .post(`/api/work-orders/${id}/evidence`)
      .field('kind', kind)
      .field('note', note)
      .attach('file', Buffer.from(`fake ${kind} bytes`), { filename: `${kind}.bin`, contentType: MIME[kind] });
  const detail = async (id: string) => {
    await engine.whenIdle(id);
    return (await api.get(`/api/work-orders/${id}`)).body as WorkOrderDetail;
  };
  const statuses = (d: WorkOrderDetail) => d.requirements.map((r) => r.status);

  return { api, create, upload, detail, statuses };
}

describe('demo scenario: replace emergency light in Room 204 (DEV fixture provider)', () => {
  const { api, create, upload, detail, statuses } = setup(new DevFixtureProvider(0));

  it('runs the full loop: analyze → request minimum evidence → new evidence → re-analyze → verified', async () => {
    const id = await create();

    // Checklist is built with nothing proven.
    let d = await detail(id);
    expect(d.workOrder.status).toBe('AWAITING_EVIDENCE');
    expect(statuses(d)).toEqual(Array(6).fill('NOT_PROVEN'));

    // Initial evidence: before photo, after photo, manual, close-up. No video.
    for (const kind of ['before_photo', 'after_photo', 'document', 'additional_photo'] as const) {
      const res = await upload(id, kind);
      expect(res.status).toBe(201);
      expect(res.body.reanalysis).toBe('skipped_no_prior_run');
    }

    expect((await api.post(`/api/work-orders/${id}/analyze`)).status).toBe(202);
    d = await detail(id);
    expect(statuses(d)).toEqual(['PROVEN', 'PROVEN', 'PROVEN', 'PROVEN', 'UNCERTAIN', 'NOT_PROVEN']);
    expect(d.workOrder.status).toBe('NEEDS_EVIDENCE');
    expect(d.workOrder.simulated).toBe(true);

    // Unproven requirements say so explicitly, and nothing reports a confidence it does not have.
    for (const requirement of d.requirements.slice(4)) {
      expect(requirement.assessment?.reasoning).toContain(CANNOT_VERIFY);
    }
    expect(d.requirements.every((r) => r.assessment?.confidence === null)).toBe(true);
    expect(d.requirements.every((r) => r.assessment?.simulated === true)).toBe(true);

    // Exactly one request, covering both unresolved requirements.
    const open = d.requests.filter((r) => r.status === 'OPEN');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      kind: 'video',
      instruction: 'Upload a 5–10 second video showing the emergency light functional test.',
      requirementIds: [d.requirements[4]!.id, d.requirements[5]!.id],
    });

    // New evidence triggers re-analysis of the affected requirements only.
    const res = await upload(id, 'video');
    expect(res.body.reanalysis).toBe('started');
    expect(res.body.evidence.requestId).toBe(open[0]!.id);

    d = await detail(id);
    expect(statuses(d)).toEqual(Array(6).fill('PROVEN'));
    expect(d.workOrder.status).toBe('VERIFIED');
    expect(d.requests.map((r) => r.status)).toEqual(['FULFILLED']);
    expect(d.runs).toHaveLength(2);
    expect(d.runs[1]).toMatchObject({ trigger: 'new_evidence', status: 'COMPLETED', simulated: true });
    expect(d.runs[1]!.requirementIds).toEqual([d.requirements[4]!.id, d.requirements[5]!.id]);

    // The audit trail records the whole chain, in order.
    const types = d.audit.map((event) => event.type);
    expect(types.slice(0, 2)).toEqual(['WORK_ORDER_CREATED', 'CHECKLIST_BUILT']);
    expect(types.filter((t) => t === 'EVIDENCE_UPLOADED')).toHaveLength(5);
    expect(types).toContain('EVIDENCE_REQUESTED');
    expect(types).toContain('EVIDENCE_REQUEST_FULFILLED');
    expect(types.at(-1)).toBe('ANALYSIS_COMPLETED');
    expect(d.audit.at(-1)!.summary).toContain('DEV FIXTURE');
    expect(d.evidence.every((item) => /^[0-9a-f]{64}$/.test(item.sha256))).toBe(true);
  });

  it('re-opens a proven requirement when new evidence contradicts it', async () => {
    const id = await create();
    for (const kind of ['before_photo', 'after_photo', 'document', 'additional_photo', 'video'] as const) {
      await upload(id, kind);
    }
    await api.post(`/api/work-orders/${id}/analyze`);
    expect((await detail(id)).workOrder.status).toBe('VERIFIED');

    await upload(id, 'additional_photo', 'loose bracket #contradict');
    const d = await detail(id);
    expect(d.workOrder.status).toBe('CONTRADICTED');
    expect(statuses(d)).toEqual(['PROVEN', 'PROVEN', 'CONTRADICTED', 'CONTRADICTED', 'PROVEN', 'PROVEN']);
  });

  it('rejects a file whose type does not match the evidence kind', async () => {
    const id = await create();
    const res = await api
      .post(`/api/work-orders/${id}/evidence`)
      .field('kind', 'video')
      .attach('file', Buffer.from('x'), { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
  });

  it('rejects files over the upload limit', async () => {
    const id = await create();
    const res = await api
      .post(`/api/work-orders/${id}/evidence`)
      .field('kind', 'video')
      .attach('file', Buffer.alloc(2 * 1024 * 1024), { filename: 'big.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(413);
  });

  it('requires at least one mandatory requirement', async () => {
    const res = await api
      .post('/api/work-orders')
      .send({ title: 'x', requirements: [{ title: 'optional', mandatory: false }] });
    expect(res.status).toBe(400);
  });
});

describe('a provider that overclaims', () => {
  // Says everything is PROVEN with total confidence, citing nothing real.
  const overclaiming: AiProvider = {
    id: 'nebius-nemotron',
    model: 'test-double',
    simulated: false,
    assess: async ({ requirements }) =>
      requirements.map((r) => ({
        requirementId: r.id,
        status: 'PROVEN',
        reasoning: 'Looks done.',
        confidence: 1,
        observations: [{ evidenceId: 'made-up-id', kind: 'direct', text: 'I can see it works.' }],
      })),
  };
  const { api, create, upload, detail, statuses } = setup(overclaiming);

  it('cannot make the work order pass', async () => {
    const id = await create();
    await upload(id, 'after_photo');
    await api.post(`/api/work-orders/${id}/analyze`);

    const d = await detail(id);
    expect(statuses(d)).toEqual(Array(6).fill('NOT_PROVEN'));
    expect(d.workOrder.status).toBe('NEEDS_EVIDENCE');
    expect(d.requirements.every((r) => r.assessment?.confidence === null)).toBe(true);
    expect(d.requests.filter((r) => r.status === 'OPEN').length).toBeGreaterThan(0);
  });
});

describe('a provider that fails', () => {
  const failing: AiProvider = {
    id: 'nebius-nemotron',
    model: 'test-double',
    simulated: false,
    assess: async () => {
      throw new Error('upstream unavailable');
    },
  };
  const { api, create, upload, detail, statuses } = setup(failing);

  it('leaves every status unchanged and records the failure', async () => {
    const id = await create();
    await upload(id, 'after_photo');
    await api.post(`/api/work-orders/${id}/analyze`);

    const d = await detail(id);
    expect(statuses(d)).toEqual(Array(6).fill('NOT_PROVEN'));
    expect(d.workOrder.status).toBe('AWAITING_EVIDENCE');
    expect(d.runs[0]).toMatchObject({ status: 'FAILED', error: 'upstream unavailable' });
    expect(d.audit.at(-1)!.type).toBe('ANALYSIS_FAILED');
  });
});

describe('production AI not configured', () => {
  const { api, create, upload, detail } = setup(null);

  it('refuses to verify instead of pretending', async () => {
    const id = await create();
    expect((await upload(id, 'after_photo')).status).toBe(201);

    const res = await api.post(`/api/work-orders/${id}/analyze`);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_NOT_CONFIGURED');

    const d = await detail(id);
    expect(d.workOrder.status).toBe('AWAITING_EVIDENCE');
    expect(d.runs).toEqual([]);
  });

  it('returns 404 for unknown work orders', async () => {
    expect((await api.get('/api/work-orders/not-a-uuid')).status).toBe(404);
    expect((await api.get('/api/work-orders/11111111-1111-4111-8111-111111111111')).status).toBe(404);
  });
});
