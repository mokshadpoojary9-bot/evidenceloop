import { describe, expect, it } from 'vitest';
import { applyPolicy } from '../agent/policy.js';
import type { Evidence, Requirement, WorkOrder } from '../types.js';
import { DEV_FIXTURE_LABEL, DevFixtureProvider } from './devFixtureProvider.js';

const T = '2026-10-18T10:00:00.000Z';
const workOrder = { id: 'wo-1' } as WorkOrder;
const requirement = (id: string, kind: Evidence['kind']): Requirement => ({
  id,
  workOrderId: 'wo-1',
  position: 1,
  title: id,
  description: '',
  mandatory: true,
  evidenceNeeds: [{ kind, instruction: 'x' }],
  status: 'NOT_PROVEN',
  currentAssessmentId: null,
  updatedAt: T,
});
const file = (id: string, kind: Evidence['kind']): Evidence => ({
  id,
  workOrderId: 'wo-1',
  kind,
  fileName: `${id}.bin`,
  mimeType: 'application/octet-stream',
  sizeBytes: 1,
  sha256: 'a'.repeat(64),
  storagePath: id,
  note: '',
  requestId: null,
  uploadedBy: 'tech',
  createdAt: T,
});

describe('DEV fixture (simulated, not AI)', () => {
  it('adds labelled inferred observations from an attached manual without changing any status', async () => {
    const provider = new DevFixtureProvider(0);
    const requirements = [
      requirement('needs-photo', 'after_photo'),
      requirement('needs-video', 'video'),
      requirement('needs-manual', 'document'),
    ];
    const evidence = [file('photo', 'after_photo'), file('manual', 'document')];
    const raw = await provider.assess({ workOrder, requirements, evidence });
    const ids = new Set(evidence.map((e) => e.id));
    const [photo, video, manual] = raw.map((r, i) => applyPolicy(requirements[i]!, r, ids));

    // Proven on its direct observation; the manual is only an inferred, simulated extra.
    expect(photo!.status).toBe('PROVEN');
    expect(photo!.observations.map((o) => [o.evidenceId, o.kind])).toEqual([
      ['photo', 'direct'],
      ['manual', 'inferred'],
    ]);
    // An inference never proves anything: no video, so still not proven.
    expect(video!.status).toBe('NOT_PROVEN');
    expect(video!.observations.map((o) => o.kind)).toEqual(['inferred']);
    // A requirement that asks for the manual sees it directly, not as an inference.
    expect(manual!.observations.map((o) => o.kind)).toEqual(['direct']);
    for (const o of [...photo!.observations, ...video!.observations]) expect(o.text).toContain(DEV_FIXTURE_LABEL);
  });
});
