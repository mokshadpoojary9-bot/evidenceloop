import { describe, expect, it } from 'vitest';
import { CANNOT_VERIFY, type Requirement } from '../types.js';
import { planEvidenceRequests } from './planner.js';
import { applyPolicy, overallStatus } from './policy.js';

const requirement = (overrides: Partial<Requirement> = {}): Requirement => ({
  id: 'req-1',
  workOrderId: 'wo-1',
  position: 1,
  title: 'Functional test completed',
  description: '',
  mandatory: true,
  evidenceNeeds: [{ kind: 'video', instruction: 'Upload a video of the test.' }],
  status: 'NOT_PROVEN',
  currentAssessmentId: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const evidenceIds = new Set(['ev-1']);
const direct = { evidenceId: 'ev-1', kind: 'direct', text: 'The lamp lights when the test button is held.' };

describe('verification policy', () => {
  it('accepts PROVEN backed by a direct observation of attached evidence', () => {
    const decision = applyPolicy(
      requirement(),
      { requirementId: 'req-1', status: 'PROVEN', reasoning: 'Shown on video.', confidence: 0.9, observations: [{ ...direct, startSec: 2, endSec: 6 }] },
      evidenceIds,
    );
    expect(decision.status).toBe('PROVEN');
    expect(decision.confidence).toBe(0.9);
    expect(decision.observations[0]).toMatchObject({ startSec: 2, endSec: 6 });
    expect(decision.policyNotes).toEqual([]);
  });

  it('defaults to NOT_PROVEN when the provider returns nothing usable', () => {
    for (const raw of [undefined, null, 'PROVEN', { requirementId: 'req-1', status: 'DEFINITELY' }]) {
      const decision = applyPolicy(requirement(), raw, evidenceIds);
      expect(decision.status).toBe('NOT_PROVEN');
      expect(decision.reasoning).toContain(CANNOT_VERIFY);
      expect(decision.confidence).toBeNull();
    }
  });

  it('ignores an assessment addressed to a different requirement', () => {
    const decision = applyPolicy(
      requirement(),
      { requirementId: 'req-2', status: 'PROVEN', reasoning: 'ok', observations: [direct] },
      evidenceIds,
    );
    expect(decision.status).toBe('NOT_PROVEN');
  });

  it('downgrades PROVEN that cites no evidence', () => {
    const decision = applyPolicy(
      requirement(),
      { requirementId: 'req-1', status: 'PROVEN', reasoning: 'It looks fine.', confidence: 0.99 },
      evidenceIds,
    );
    expect(decision.status).toBe('NOT_PROVEN');
    expect(decision.confidence).toBeNull();
    expect(decision.reasoning.startsWith(CANNOT_VERIFY)).toBe(true);
    expect(decision.policyNotes.join(' ')).toContain('downgraded');
  });

  it('downgrades PROVEN that cites evidence which does not exist', () => {
    const decision = applyPolicy(
      requirement(),
      { requirementId: 'req-1', status: 'PROVEN', reasoning: 'Seen.', observations: [{ ...direct, evidenceId: 'invented' }] },
      evidenceIds,
    );
    expect(decision.status).toBe('NOT_PROVEN');
    expect(decision.observations).toEqual([]);
  });

  it('downgrades PROVEN resting only on inference to UNCERTAIN', () => {
    const decision = applyPolicy(
      requirement(),
      { requirementId: 'req-1', status: 'PROVEN', reasoning: 'Probably tested.', observations: [{ ...direct, kind: 'inferred' }] },
      evidenceIds,
    );
    expect(decision.status).toBe('UNCERTAIN');
  });

  it('downgrades CONTRADICTED without evidence to UNCERTAIN', () => {
    const decision = applyPolicy(
      requirement(),
      { requirementId: 'req-1', status: 'CONTRADICTED', reasoning: 'Conflict.' },
      evidenceIds,
    );
    expect(decision.status).toBe('UNCERTAIN');
  });

  it('never invents confidence and rejects out-of-range values', () => {
    const base = { requirementId: 'req-1', status: 'PROVEN', reasoning: 'Shown.', observations: [direct] };
    expect(applyPolicy(requirement(), base, evidenceIds).confidence).toBeNull();
    expect(applyPolicy(requirement(), { ...base, confidence: 95 }, evidenceIds).confidence).toBeNull();
    expect(applyPolicy(requirement(), { ...base, confidence: 'high' }, evidenceIds).confidence).toBeNull();
  });

  it('states that it cannot verify when evidence is insufficient', () => {
    const decision = applyPolicy(
      requirement(),
      { requirementId: 'req-1', status: 'UNCERTAIN', reasoning: 'The video is too dark.', observations: [direct] },
      evidenceIds,
    );
    expect(decision.reasoning).toBe(`${CANNOT_VERIFY} The video is too dark.`);
  });

  it('drops invalid timestamp ranges', () => {
    const decision = applyPolicy(
      requirement(),
      { requirementId: 'req-1', status: 'PROVEN', reasoning: 'Shown.', observations: [{ ...direct, startSec: 9, endSec: 3 }] },
      evidenceIds,
    );
    expect(decision.observations[0]).toMatchObject({ startSec: null, endSec: null });
  });
});

describe('overall status', () => {
  const r = (status: Requirement['status'], mandatory = true) => ({ status, mandatory });

  it('is VERIFIED only when every mandatory requirement is PROVEN', () => {
    expect(overallStatus([r('PROVEN'), r('PROVEN')])).toBe('VERIFIED');
    expect(overallStatus([r('PROVEN'), r('UNCERTAIN')])).toBe('NEEDS_EVIDENCE');
    expect(overallStatus([r('PROVEN'), r('NOT_PROVEN', false)])).toBe('VERIFIED');
  });

  it('is never VERIFIED while anything is contradicted', () => {
    expect(overallStatus([r('PROVEN'), r('CONTRADICTED', false)])).toBe('CONTRADICTED');
  });

  it('is not VERIFIED when there are no mandatory requirements', () => {
    expect(overallStatus([r('PROVEN', false)])).toBe('NEEDS_EVIDENCE');
  });
});

describe('evidence request planning', () => {
  const video = { kind: 'video' as const, instruction: 'Upload a video of the test.' };
  const photo = { kind: 'after_photo' as const, instruction: 'Upload an after photo.' };

  it('merges needs of the same kind into one request', () => {
    const planned = planEvidenceRequests(
      [
        { requirement: requirement({ id: 'a', status: 'UNCERTAIN' }), missingEvidence: [video] },
        { requirement: requirement({ id: 'b' }), missingEvidence: [video] },
      ],
      [],
    );
    expect(planned).toEqual([{ ...video, requirementIds: ['a', 'b'] }]);
  });

  it('requests nothing for proven, optional or contradicted requirements', () => {
    const planned = planEvidenceRequests(
      [
        { requirement: requirement({ id: 'a', status: 'PROVEN' }), missingEvidence: [video] },
        { requirement: requirement({ id: 'b', mandatory: false }), missingEvidence: [video] },
        { requirement: requirement({ id: 'c', status: 'CONTRADICTED' }), missingEvidence: [video] },
      ],
      [],
    );
    expect(planned).toEqual([]);
  });

  it('falls back to the requirement own needs that are not yet uploaded', () => {
    const planned = planEvidenceRequests(
      [{ requirement: requirement({ evidenceNeeds: [photo, video] }), missingEvidence: [] }],
      [{ kind: 'after_photo' }],
    );
    expect(planned).toEqual([{ ...video, requirementIds: ['req-1'] }]);
  });
});
