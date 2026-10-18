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
import { makePdf } from './test/fixtures.js';
import {
  CANNOT_VERIFY,
  type DashboardData,
  type EvidenceKind,
  type RequirementDraftResponse,
  type SystemStatus,
  type WorkOrderDetail,
} from './types.js';

const tempDir = mkdtempSync(join(tmpdir(), 'evidenceloop-test-'));
// Mirrors the real local layout (`.data/uploads`), including the dot-directory.
const uploadDir = join(tempDir, '.data', 'uploads');
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

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
  const app = createApp({ db, files, engine, ai: provider, supabase: null, system, corsOrigins: [] });
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

  it('re-analyzes only the requirements new evidence affects, even when nothing is proven', async () => {
    const id = await create();
    await upload(id, 'before_photo');
    expect((await api.post(`/api/work-orders/${id}/analyze`)).status).toBe(202);
    let d = await detail(id);
    expect(statuses(d)).not.toContain('PROVEN');

    // The video affects the two requirements that list a video (#5, #6), not all six.
    await upload(id, 'video');
    d = await detail(id);
    expect(d.runs[1]!.requirementIds).toEqual([d.requirements[4]!.id, d.requirements[5]!.id]);

    // Evidence that no requirement asks for still re-assesses every unproven requirement.
    const unproven = d.requirements.filter((r) => r.status !== 'PROVEN').map((r) => r.id);
    await upload(id, 'transcript');
    d = await detail(id);
    expect(d.runs[2]!.requirementIds).toEqual(unproven);
  });

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

  it('serves uploaded files in local mode (the data directory is a dot-directory)', async () => {
    const id = await create();
    await upload(id, 'after_photo');
    const d = await detail(id);
    const res = await api.get(d.evidence[0]!.url!);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('fake after_photo bytes');
  });

  it('records whether an uploaded PDF has a text layer the AI can read', async () => {
    const id = await create();
    const attach = (pdf: Buffer, filename: string) =>
      api.post(`/api/work-orders/${id}/evidence`).field('kind', 'document').attach('file', pdf, { filename, contentType: 'application/pdf' });
    expect((await attach(makePdf(['Install model EL-200.', 'Test for 30 s.']), 'manual.pdf')).status).toBe(201);
    expect((await attach(makePdf(['']), 'scan.pdf')).status).toBe(201);
    await upload(id, 'after_photo');
    const d = await detail(id);
    expect(d.evidence.map((e) => e.pdf)).toEqual([{ pages: 2, textLayer: true }, { pages: 1, textLayer: false }, null]);
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
    draftRequirements: async () => [],
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
    draftRequirements: async () => [],
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

describe('work order management', () => {
  const { api, create, upload, detail } = setup(new DevFixtureProvider(0));

  it('edits details and records the change in the audit trail', async () => {
    const id = await create();
    const res = await api.patch(`/api/work-orders/${id}`).send({ title: 'Replace emergency light in Room 205', location: 'Room 205' });
    expect(res.status).toBe(200);
    const d = res.body as WorkOrderDetail;
    expect(d.workOrder).toMatchObject({ title: 'Replace emergency light in Room 205', location: 'Room 205' });
    expect(d.audit.at(-1)).toMatchObject({ type: 'WORK_ORDER_EDITED' });
    expect(d.audit.at(-1)!.data.title).toEqual({ from: 'Replace emergency light in Room 204', to: 'Replace emergency light in Room 205' });

    expect((await api.patch(`/api/work-orders/${id}`).send({ title: '' })).status).toBe(400);
    expect((await api.patch(`/api/work-orders/${id}`).send({ ownerId: 'someone-else' })).status).toBe(400);
  });

  it('makes archived work orders read-only until unarchived', async () => {
    const id = await create();
    const archived = await api.post(`/api/work-orders/${id}/archive`);
    expect(archived.body.workOrder.archivedAt).toEqual(expect.any(String));

    expect((await upload(id, 'after_photo')).status).toBe(409);
    expect((await api.post(`/api/work-orders/${id}/analyze`)).status).toBe(409);
    expect((await api.patch(`/api/work-orders/${id}`).send({ title: 'x' })).status).toBe(409);

    const list = (await api.get('/api/work-orders')).body.workOrders as { id: string; archivedAt: string | null }[];
    expect(list.find((w) => w.id === id)?.archivedAt).toEqual(expect.any(String));

    await api.post(`/api/work-orders/${id}/unarchive`);
    expect((await upload(id, 'after_photo')).status).toBe(201);
    const types = (await detail(id)).audit.map((event) => event.type);
    expect(types).toEqual(expect.arrayContaining(['WORK_ORDER_ARCHIVED', 'WORK_ORDER_UNARCHIVED']));
  });

  it('deletes a work order with its evidence files', async () => {
    const id = await create();
    await upload(id, 'after_photo');
    const fileUrl = (await detail(id)).evidence[0]!.url!;
    expect((await api.get(fileUrl)).status).toBe(200);

    expect((await api.delete(`/api/work-orders/${id}`)).status).toBe(204);
    expect((await api.get(`/api/work-orders/${id}`)).status).toBe(404);
    expect((await api.get(fileUrl)).status).toBe(404);
    const list = (await api.get('/api/work-orders')).body.workOrders as { id: string }[];
    expect(list.some((w) => w.id === id)).toBe(false);
  });

  it('exports a PDF report with requirements, evidence, audit trail, disclaimer and simulated labels', async () => {
    const id = await create();
    await upload(id, 'after_photo', 'unit fitted');
    await api.post(`/api/work-orders/${id}/analyze`);
    await detail(id);

    const res = await api.get(`/api/work-orders/${id}/report.pdf`).buffer(true).parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="evidenceloop-report-.*\.pdf"/);

    const { extractText, getDocumentProxy } = await import('unpdf');
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(res.body as Buffer)), { mergePages: true });
    const flat = text.replace(/\s+/g, ' ');
    expect(flat).toContain('Replace emergency light in Room 204');
    expect(flat).toContain('Correct emergency light installed');
    expect(flat).toContain('after_photo.bin');
    expect(flat).toContain('does not replace qualified inspectors');
    expect(flat).toContain('DEV ONLY');
    expect(flat).toContain('ANALYSIS_COMPLETED');
    expect(flat).toContain(CANNOT_VERIFY);
  });
});

describe('SOP → requirements (DEV fixture provider)', () => {
  const { api, create, upload, detail } = setup(new DevFixtureProvider(0));
  const SOP_LINES = [
    'Emergency light replacement SOP',
    '1. The replacement unit must be model EL-200.',
    '2. Fix the unit to the wall bracket with all four screws.',
    '3. Press the test button; the lamp shall illuminate.',
  ];

  const draft = (file: Buffer, contentType: string, filename: string) =>
    api.post('/api/requirements/draft').field('title', 'Replace emergency light').attach('file', file, { filename, contentType });

  it('drafts a clearly simulated list from a PDF without saving anything', async () => {
    const id = await create();
    const before = (await detail(id)).requirements.length;

    const res = await draft(makePdf([SOP_LINES.join('\n')]), 'application/pdf', 'sop.pdf');
    expect(res.status).toBe(200);
    const body = res.body as RequirementDraftResponse;
    expect(body.simulated).toBe(true);
    expect(body.provider).toBe('dev-fixture');
    expect(body.source).toMatchObject({ fileName: 'sop.pdf', pages: 1, truncated: false });
    expect(body.proposals.map((p) => p.sourceQuote)).toEqual(SOP_LINES.slice(1));
    expect(body.proposals.every((p) => p.description.includes('DEV FIXTURE'))).toBe(true);
    expect(body.proposals.map((p) => p.evidenceNeeds[0]!.kind)).toEqual(['after_photo', 'additional_photo', 'video']);

    expect((await detail(id)).requirements.length).toBe(before);
  });

  it('drafts from a plain-text SOP', async () => {
    const res = await draft(Buffer.from(SOP_LINES.join('\n')), 'text/plain', 'sop.txt');
    expect(res.status).toBe(200);
    expect((res.body as RequirementDraftResponse).proposals).toHaveLength(3);
  });

  it('refuses a scanned PDF with no text layer', async () => {
    const res = await draft(makePdf(['']), 'application/pdf', 'scan.pdf');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NO_TEXT');
  });

  it('saves only the confirmed requirements and re-opens a verified work order', async () => {
    const id = await create();
    for (const kind of ['before_photo', 'after_photo', 'document', 'additional_photo', 'video'] as const) {
      await upload(id, kind);
    }
    await api.post(`/api/work-orders/${id}/analyze`);
    expect((await detail(id)).workOrder.status).toBe('VERIFIED');

    const res = await api.post(`/api/work-orders/${id}/requirements`).send({
      requirements: [
        {
          title: 'Lamp illuminates on test',
          description: 'Edited by the reviewer of the draft',
          mandatory: true,
          evidenceNeeds: [{ kind: 'video', instruction: 'Film the test.' }],
        },
      ],
      source: { kind: 'sop', fileName: 'sop.pdf', simulated: true },
    });
    expect(res.status).toBe(201);
    const d = res.body as WorkOrderDetail;
    expect(d.requirements).toHaveLength(7);
    expect(d.requirements[6]).toMatchObject({ position: 7, title: 'Lamp illuminates on test', status: 'NOT_PROVEN' });
    expect(d.workOrder.status).toBe('NEEDS_EVIDENCE');
    const added = d.audit.find((event) => event.type === 'REQUIREMENTS_ADDED')!;
    expect(added.summary).toContain('DEV fixture (simulated, not AI)');
    expect(d.audit.at(-1)).toMatchObject({ type: 'STATUS_CHANGED' });

    expect((await api.post(`/api/work-orders/${id}/requirements`).send({ requirements: [], source: { kind: 'manual' } })).status).toBe(400);
  });
});

describe('SOP drafting with a provider that invents requirements', () => {
  const inventing: AiProvider = {
    id: 'nebius-nemotron',
    model: 'test-double',
    simulated: false,
    assess: async () => [],
    draftRequirements: async () => [
      { title: 'Model EL-200', mandatory: true, evidenceNeeds: [], sourceQuote: 'The replacement unit must be model EL-200.' },
      { title: 'Torque bracket to 5 Nm', mandatory: true, evidenceNeeds: [], sourceQuote: 'Torque the bracket to 5 Nm.' },
    ],
  };
  const { api } = setup(inventing);

  it('drops proposals the SOP does not support', async () => {
    const res = await api
      .post('/api/requirements/draft')
      .attach('file', Buffer.from('1. The replacement unit must be model EL-200.'), { filename: 's.txt', contentType: 'text/plain' });
    expect(res.body.proposals.map((p: { title: string }) => p.title)).toEqual(['Model EL-200']);
    expect(res.body.dropped).toBe(1);
    expect(res.body.simulated).toBe(false);
  });
});

describe('SOP drafting without AI', () => {
  const { api } = setup(null);
  it('is refused rather than faked', async () => {
    const res = await api
      .post('/api/requirements/draft')
      .attach('file', Buffer.from('1. Do the thing.'), { filename: 's.txt', contentType: 'text/plain' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_NOT_CONFIGURED');
  });
});

describe('roles and reviewer sign-off', () => {
  const { api, create, upload, detail, statuses } = setup(new DevFixtureProvider(0));
  const reviewer = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
    api[method](path).set('X-Demo-Role', 'reviewer');

  /** Demo scenario after the first run: NEEDS_EVIDENCE with "Indicator functioning" UNCERTAIN. */
  async function uncertainWorkOrder() {
    const id = await create();
    for (const kind of ['before_photo', 'after_photo', 'document', 'additional_photo'] as const) await upload(id, kind);
    await api.post(`/api/work-orders/${id}/analyze`);
    const d = await detail(id);
    expect(d.workOrder.status).toBe('NEEDS_EVIDENCE');
    expect(statuses(d)).toContain('UNCERTAIN');
    return id;
  }

  it('reports who is signed in and in which role', async () => {
    expect((await api.get('/api/me')).body).toMatchObject({ role: 'technician', roleSource: 'demo' });
    expect((await reviewer('get', '/api/me')).body).toMatchObject({ role: 'reviewer', roleSource: 'demo' });
  });

  it('runs submit → in review → approve with note, recorded as a human decision', async () => {
    const id = await uncertainWorkOrder();
    expect((await detail(id)).permissions).toMatchObject({ submitForReview: true, review: false });

    const submitted = await api.post(`/api/work-orders/${id}/reviews`).send({ note: 'Indicator hard to see in photo' });
    expect(submitted.status).toBe(201);
    expect(submitted.body.workOrder.status).toBe('IN_REVIEW');
    expect(submitted.body.reviews[0]).toMatchObject({ status: 'PENDING', statusAtSubmission: 'NEEDS_EVIDENCE' });

    // Frozen while in review.
    expect((await upload(id, 'video')).status).toBe(409);
    expect((await api.post(`/api/work-orders/${id}/analyze`)).status).toBe(409);
    expect((await api.post(`/api/work-orders/${id}/reviews`).send({})).status).toBe(409);

    // The technician cannot decide; the reviewer can, and must leave a note.
    expect((await api.post(`/api/work-orders/${id}/reviews/decision`).send({ decision: 'approve', note: 'fine' })).status).toBe(403);
    expect((await reviewer('post', `/api/work-orders/${id}/reviews/decision`).send({ decision: 'approve', note: '' })).status).toBe(400);

    const reviewerView = await reviewer('get', `/api/work-orders/${id}`);
    expect(reviewerView.body.permissions).toMatchObject({ manage: false, upload: false, review: true });

    const approved = await reviewer('post', `/api/work-orders/${id}/reviews/decision`).send({
      decision: 'approve',
      note: 'Indicator confirmed lit during site visit.',
    });
    expect(approved.status).toBe(200);
    const d = approved.body as WorkOrderDetail;
    expect(d.workOrder.status).toBe('APPROVED');
    expect(d.reviews[0]).toMatchObject({ status: 'APPROVED', decisionNote: 'Indicator confirmed lit during site visit.' });
    const event = d.audit.at(-1)!;
    expect(event.type).toBe('REVIEW_APPROVED');
    expect(event.summary).toContain('human decision, not AI verification');
    expect(event.data).toMatchObject({ actorRole: 'reviewer', decision: 'approve' });
    expect(event.actor).not.toBe(d.audit.find((e) => e.type === 'REVIEW_REQUESTED')!.actor);
    // The requirements themselves are untouched: approval does not make anything PROVEN.
    expect(statuses(d)).toContain('UNCERTAIN');
  });

  it('rejects', async () => {
    const id = await uncertainWorkOrder();
    await api.post(`/api/work-orders/${id}/reviews`).send({});
    const res = await reviewer('post', `/api/work-orders/${id}/reviews/decision`).send({ decision: 'reject', note: 'Wrong unit model.' });
    expect(res.body.workOrder.status).toBe('REJECTED');
    expect(res.body.audit.at(-1).type).toBe('REVIEW_REJECTED');
  });

  it('requests more evidence: the request stays open through re-analysis until it is answered', async () => {
    const id = await uncertainWorkOrder();
    await api.post(`/api/work-orders/${id}/reviews`).send({});
    const res = await reviewer('post', `/api/work-orders/${id}/reviews/decision`).send({
      decision: 'request_evidence',
      note: 'Need to see the indicator.',
      request: { kind: 'additional_photo', instruction: 'Upload a close-up of the lit charge indicator.' },
    });
    expect(res.status).toBe(200);
    let d = res.body as WorkOrderDetail;
    expect(d.workOrder.status).toBe('NEEDS_EVIDENCE');
    const reviewerRequest = d.requests.find((r) => r.requestedBy.startsWith('user:'))!;
    expect(reviewerRequest).toMatchObject({ status: 'OPEN', runId: null, kind: 'additional_photo' });

    // A re-analysis triggered by other evidence must not retire the reviewer's request.
    await upload(id, 'after_photo');
    d = await detail(id);
    expect(d.requests.find((r) => r.id === reviewerRequest.id)!.status).toBe('OPEN');

    await upload(id, 'additional_photo');
    d = await detail(id);
    expect(d.requests.find((r) => r.id === reviewerRequest.id)!.status).toBe('FULFILLED');
  });

  it('only allows contradicted or uncertain work orders into review', async () => {
    const id = await create();
    expect((await api.post(`/api/work-orders/${id}/reviews`).send({})).status).toBe(409);
    expect((await detail(id)).permissions.reasons.submitForReview).toMatch(/contradicted/);
  });

  it('lets reviewers read every work order but change nothing', async () => {
    const id = await create();
    const list = (await reviewer('get', '/api/work-orders')).body.workOrders as { id: string }[];
    expect(list.some((w) => w.id === id)).toBe(true);
    expect((await reviewer('get', `/api/work-orders/${id}`)).status).toBe(200);
    expect((await reviewer('get', `/api/work-orders/${id}/report.pdf`)).status).toBe(200);

    expect((await reviewer('post', '/api/work-orders').send({ title: 'x', templateId: 'emergency-light-replacement' })).status).toBe(403);
    expect((await reviewer('patch', `/api/work-orders/${id}`).send({ title: 'x' })).status).toBe(403);
    expect((await reviewer('post', `/api/work-orders/${id}/archive`)).status).toBe(403);
    expect((await reviewer('delete', `/api/work-orders/${id}`)).status).toBe(403);
    expect((await reviewer('post', `/api/work-orders/${id}/analyze`)).status).toBe(403);
    const uploadAsReviewer = await reviewer('post', `/api/work-orders/${id}/evidence`)
      .field('kind', 'after_photo')
      .attach('file', Buffer.from('x'), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(uploadAsReviewer.status).toBe(403);
  });
});

describe('dashboard', () => {
  const { api, create, upload, detail } = setup(new DevFixtureProvider(0));

  it('counts work orders by status and lists open requests and recent activity', async () => {
    const id = await create();
    await create(); // a second one, still a draft
    for (const kind of ['before_photo', 'after_photo', 'additional_photo', 'document'] as const) await upload(id, kind);
    await api.post(`/api/work-orders/${id}/analyze`);
    await detail(id);

    const res = await api.get('/api/dashboard');
    expect(res.status).toBe(200);
    const body = res.body as DashboardData;
    expect(body.counts).toEqual({ VERIFIED: 0, NEEDS_EVIDENCE: 1, IN_REVIEW: 0, CONTRADICTED: 0, AWAITING_EVIDENCE: 1 });
    expect(body.openRequests.length).toBeGreaterThan(0);
    expect(body.openRequests[0]).toMatchObject({ workOrderId: id, kind: 'video' });
    expect(body.openRequests[0]!.requirementTitles.length).toBeGreaterThan(0);
    expect(body.awaitingReview).toEqual([]);

    expect(body.activity).toHaveLength(10);
    const times = body.activity.map((event) => event.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    const actors = new Set(body.activity.map((event) => event.actor));
    expect(actors.has('Agent')).toBe(true);
    for (const actor of actors) expect(['You', 'Agent', 'System']).toContain(actor);
    expect(JSON.stringify(body.activity)).not.toMatch(/user:|@/);
  });
});
