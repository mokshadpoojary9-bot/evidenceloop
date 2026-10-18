import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { LOCAL_DEV_USER, LOCAL_REVIEWER } from '../middleware/auth.js';
import { LocalFileStore } from '../stores/fileStore.js';
import { LocalDb } from '../stores/localDb.js';
import { createWorkOrder } from '../stores/writes.js';
import { DEMO_IDS, DEMO_WORK_ORDER_IDS, resetDemo, seedDemo } from './seedDemo.js';

const demoDir = fileURLToPath(new URL('../../../demo', import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), 'evidenceloop-seed-'));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

function setup() {
  const db = new LocalDb();
  const files = new LocalFileStore(join(tempDir, String(Math.random())));
  return { db, files, deps: { db, files, owner: LOCAL_DEV_USER, demoDir } };
}

describe('demo seed', () => {
  it('builds the three demo work orders through the engine, all simulated', async () => {
    const { db, deps } = setup();
    const { created } = await seedDemo(deps);
    expect(created.map((w) => w.status)).toEqual(['CONTRADICTED', 'VERIFIED', 'NEEDS_EVIDENCE']);

    const runs = await db.list('analysis_runs');
    const assessments = await db.list('assessments');
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((run) => run.simulated && run.provider === 'dev-fixture')).toBe(true);
    expect(assessments.every((a) => a.simulated && a.confidence === null)).toBe(true);
    expect(created.every((w) => w.simulated)).toBe(true);

    // Room 204: partly proven, the functional-test video is the open request.
    const room = await db.list('requirements', { workOrderId: DEMO_IDS.room204 }, 'position');
    expect(room.map((r) => r.status)).toEqual(['PROVEN', 'PROVEN', 'PROVEN', 'PROVEN', 'UNCERTAIN', 'NOT_PROVEN']);
    const open = await db.list('evidence_requests', { workOrderId: DEMO_IDS.room204, status: 'OPEN' });
    expect(open).toHaveLength(1);
    expect(open[0]!.instruction).toContain('Upload a 5–10 second video showing the emergency light functional test.');

    // Corridor B: the loop ran twice — a request, its answer, then re-analysis to VERIFIED.
    const corridorRuns = await db.list('analysis_runs', { workOrderId: DEMO_IDS.corridorB }, 'startedAt');
    expect(corridorRuns.map((run) => run.trigger)).toEqual(['manual', 'new_evidence']);
    const corridorRequests = await db.list('evidence_requests', { workOrderId: DEMO_IDS.corridorB });
    expect(corridorRequests.map((r) => r.status)).toEqual(['FULFILLED']);
    const corridorAudit = (await db.list('audit_events', { workOrderId: DEMO_IDS.corridorB })).map((e) => e.type);
    expect(corridorAudit).toEqual(expect.arrayContaining(['EVIDENCE_REQUESTED', 'EVIDENCE_REQUEST_FULFILLED', 'ANALYSIS_COMPLETED']));

    // Lab 3: only the model requirement is contradicted.
    const lab = await db.list('requirements', { workOrderId: DEMO_IDS.lab3 }, 'position');
    expect(lab.map((r) => r.status)).toEqual(['CONTRADICTED', 'PROVEN', 'PROVEN', 'PROVEN', 'NOT_PROVEN']);
  });

  it('is idempotent and its reset removes only the demo work orders', async () => {
    const { db, files, deps } = setup();
    const mine = await createWorkOrder(db, LOCAL_DEV_USER, {
      title: 'Unrelated work',
      description: '',
      location: '',
      templateId: null,
      requirements: [{ title: 'Something', description: '', mandatory: true, evidenceNeeds: [] }],
    });
    await seedDemo(deps);
    const counts = async () => ({
      workOrders: (await db.list('work_orders')).length,
      evidence: (await db.list('evidence')).length,
      audit: (await db.list('audit_events')).length,
    });
    const first = await counts();

    const again = await seedDemo(deps);
    expect(again.created).toHaveLength(0);
    expect(again.skipped).toHaveLength(3);
    expect(await counts()).toEqual(first);

    expect(await resetDemo({ db, files })).toEqual(DEMO_WORK_ORDER_IDS);
    expect((await db.list('work_orders')).map((w) => w.id)).toEqual([mine.id]);
    expect(await db.list('evidence')).toHaveLength(0);
    expect((await db.list('audit_events')).every((e) => e.workOrderId === mine.id)).toBe(true);
    expect(await resetDemo({ db, files })).toEqual([]);
  });

  it('refuses a reviewer as owner', async () => {
    const { deps } = setup();
    await expect(seedDemo({ ...deps, owner: LOCAL_REVIEWER })).rejects.toThrow(/technician/);
  });
});
