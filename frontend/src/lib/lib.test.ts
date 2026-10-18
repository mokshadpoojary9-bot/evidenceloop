import { describe, expect, it } from 'vitest';
import { assessment, detail, summary } from '../test/fixtures';
import { CARD_COUNT, cardAt, cardFrame, easeStations, STATION_COUNT, stationAt } from './evidenceLoop';
import { FrameGovernor, type GovernorVerdict } from './frameGovernor';
import { describeInspection } from './inspection';
import { buildGraph, ringLayout, summarize } from './verificationGraph';
import { DEFAULT_QUERY, queryWorkOrders } from './workOrderQuery';

describe('queryWorkOrders', () => {
  const list = [
    summary({ id: 'a', title: 'Replace emergency light', location: 'Room 204', status: 'VERIFIED', createdAt: '2026-01-01', updatedAt: '2026-03-01' }),
    summary({ id: 'b', title: 'Fix fire door closer', location: 'Stair B', status: 'IN_REVIEW', createdAt: '2026-02-01', updatedAt: '2026-02-01' }),
    summary({ id: 'c', title: 'Replace exit sign', location: 'Room 204', status: 'VERIFIED', createdAt: '2026-03-01', updatedAt: '2026-03-02', archivedAt: '2026-03-05' }),
  ];
  const ids = (query: Partial<typeof DEFAULT_QUERY>) => queryWorkOrders([...list], { ...DEFAULT_QUERY, ...query }).map((w) => w.id);

  it('hides archived work orders by default, newest first', () => {
    expect(ids({})).toEqual(['b', 'a']);
  });

  it('searches title, location and description with every term', () => {
    expect(ids({ search: 'room 204', status: 'all' })).toEqual(['c', 'a']);
    expect(ids({ search: 'replace light' })).toEqual(['a']);
  });

  it('filters by status, archived, or everything', () => {
    expect(ids({ status: 'IN_REVIEW' })).toEqual(['b']);
    expect(ids({ status: 'VERIFIED' })).toEqual(['a']);
    expect(ids({ status: 'archived' })).toEqual(['c']);
    expect(ids({ status: 'all' })).toEqual(['c', 'b', 'a']);
  });

  it('sorts by oldest or recently updated', () => {
    expect(ids({ status: 'all', sort: 'oldest' })).toEqual(['a', 'b', 'c']);
    expect(ids({ status: 'all', sort: 'updated' })).toEqual(['c', 'a', 'b']);
  });
});

describe('describeInspection', () => {
  const file = (mimeType: string, sizeBytes = 1000) => ({ mimeType, sizeBytes });

  it('never claims the DEV fixture inspected anything', () => {
    expect(describeInspection(file('image/png'), 'dev-fixture')).toMatchObject({ tone: 'none' });
  });

  it('matches what the backend sends to Nemotron', () => {
    expect(describeInspection(file('image/jpeg'), 'nebius').tone).toBe('ok');
    expect(describeInspection(file('image/jpeg', 6 * 1024 * 1024), 'nebius').tone).toBe('none');
    expect(describeInspection(file('application/pdf'), 'nebius')).toMatchObject({ tone: 'partial', notInspected: expect.stringContaining('scanned') });
    expect(describeInspection(file('video/mp4'), 'nebius')).toMatchObject({ tone: 'partial', notInspected: expect.stringContaining('soundtrack') });
    expect(describeInspection(file('audio/mpeg'), 'nebius').tone).toBe('none');
    expect(describeInspection(file('text/plain', 50_000), 'nebius').tone).toBe('partial');
  });
});

describe('evidence loop (landing hero)', () => {
  it('eases between stations and rests at each one', () => {
    expect(easeStations(2.1)).toBe(2);
    expect(easeStations(2.999)).toBeCloseTo(3, 3);
    let previous = -Infinity;
    for (let t = 0; t < 6; t += 0.01) {
      expect(easeStations(t)).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = easeStations(t);
    }
  });

  it('turns a card green at Decide when the evidence is enough, then retires it', () => {
    expect(cardFrame(2, false)?.phase).toBe('pending');
    expect(cardFrame(3.1, false)).toMatchObject({ phase: 'proven', lane: 0 });
    expect(cardFrame(3.9, false)).toBeNull();
  });

  it('turns a card amber at Decide, sends it to Request more and loops it back to be re-analyzed', () => {
    expect(cardFrame(3.5, true)).toMatchObject({ phase: 'needs', lane: 0 });
    expect(cardFrame(4, true)?.u).toBe(4); // Request more
    const looping = cardFrame(6.5, true)!;
    expect(looping.phase).toBe('recheck');
    expect(looping.lane).toBe(1);
    const decided = cardFrame(9.1, true)!;
    expect(decided.phase).toBe('proven'); // decided again at Decide
    expect(decided.u).toBeCloseTo(3, 0);
    expect(cardFrame(9.9, true)).toBeNull();
  });

  it('never puts two visible cards in the same place', () => {
    for (let time = 0; time < 40; time += 0.05) {
      const visible = Array.from({ length: CARD_COUNT }, (_, i) => cardAt(time, i).frame).filter((f) => f && f.scale > 0.05);
      for (let a = 0; a < visible.length; a++) {
        for (let b = a + 1; b < visible.length; b++) {
          const gap = Math.abs(visible[a]!.u - visible[b]!.u);
          const apart = Math.min(gap, STATION_COUNT - gap) > 0.6 || Math.abs(visible[a]!.lane - visible[b]!.lane) > 0.6;
          expect(apart, `t=${time.toFixed(2)}`).toBe(true);
        }
      }
    }
  });

  it('maps scroll progress to stations', () => {
    expect(stationAt(0)).toBe(0);
    expect(stationAt(0.5)).toBe(3);
    expect(stationAt(1)).toBe(STATION_COUNT - 1);
    expect(stationAt(-1)).toBe(0);
  });
});

describe('FrameGovernor', () => {
  /** Runs `seconds` of frames at `fps` and returns every verdict given. */
  const run = (governor: FrameGovernor, fps: number, seconds: number) => {
    const verdicts: GovernorVerdict[] = [];
    for (let t = 0; t < seconds; t += 1 / fps) {
      const verdict = governor.tick(1 / fps);
      if (verdict) verdicts.push(verdict);
    }
    return verdicts;
  };

  it('keeps 3D at full quality when the probe holds 60 fps', () => {
    const governor = new FrameGovernor(3);
    expect(run(governor, 60, 10)).toEqual([]);
    expect(governor.quality).toBe(0);
  });

  it('falls back to 2D, once, when the first two seconds stay under 30 fps', () => {
    const governor = new FrameGovernor(3);
    expect(run(governor, 20, 10)).toEqual(['fallback']);
  });

  it('also falls back on a device too slow to render 2 fps (long frames, not pauses)', () => {
    expect(run(new FrameGovernor(3), 1.5, 20)).toEqual(['fallback']);
  });

  it('steps quality down one level per slow second, and never back up', () => {
    const governor = new FrameGovernor(3);
    expect(run(governor, 60, 3)).toEqual([]);
    expect(run(governor, 40, 2.6)).toEqual(['degrade', 'degrade']);
    expect(governor.quality).toBe(2);
    expect(run(governor, 60, 5)).toEqual([]);
    expect(governor.quality).toBe(2);
    expect(run(governor, 35, 5)).toEqual(['degrade']);
    expect(governor.settled).toBe(true);
  });

  it('treats a long pause (hidden tab) as a pause, not a slow frame', () => {
    const governor = new FrameGovernor(3);
    run(governor, 60, 3);
    expect(governor.tick(4)).toBeNull();
    expect(run(governor, 60, 3)).toEqual([]);
    expect(governor.quality).toBe(0);
  });
});

describe('verification graph (work order 3D view)', () => {
  const observation = (evidenceId: string, kind: 'direct' | 'inferred') => ({
    evidenceId,
    kind,
    text: 'seen',
    startSec: null,
    endSec: null,
  });

  it('links evidence to requirements from observations, direct winning over inferred', () => {
    const base = detail();
    const requirement = base.requirements[0]!;
    const photo = { ...base.evidence[0]!, id: 'ev-photo', kind: 'after_photo' as const, fileName: 'after.jpg' };
    const graph = buildGraph({
      ...base,
      evidence: [...base.evidence, photo],
      requirements: [
        {
          ...requirement,
          assessment: assessment({
            observations: [observation('ev-video', 'inferred'), observation('ev-video', 'direct'), observation('ev-photo', 'inferred'), observation('ev-gone', 'direct')],
          }),
        },
      ],
    });
    expect(graph.links).toEqual([
      { evidenceId: 'ev-video', requirementId: 'req-1', direct: true },
      { evidenceId: 'ev-photo', requirementId: 'req-1', direct: false },
    ]);
    expect(graph.evidence.map((e) => e.icon)).toEqual(['video', 'photo']);
  });

  it('marks requirements under an open request, and those a running run is re-checking', () => {
    const base = detail();
    const graph = buildGraph({
      ...base,
      requests: [
        { id: 'r1', workOrderId: 'wo-1', runId: null, requestedBy: 'agent', requirementIds: ['req-1'], kind: 'video', instruction: 'x', status: 'OPEN', fulfilledByEvidenceId: null, createdAt: '', updatedAt: '' },
      ],
      runs: [
        { id: 'run-2', workOrderId: 'wo-1', trigger: 'new_evidence', triggerEvidenceId: null, requirementIds: ['req-1'], provider: 'dev-fixture', model: null, simulated: true, status: 'RUNNING', error: null, startedAt: '', completedAt: null },
      ],
    });
    expect(graph.requirements[0]).toMatchObject({ requested: true, pulsing: true });
  });

  it('summarizes statuses the way the page shows them', () => {
    expect(summarize(['PROVEN', 'PROVEN', 'PROVEN', 'PROVEN', 'UNCERTAIN', 'NOT_PROVEN'])).toBe(
      '4 of 6 proven · 1 uncertain · 1 not proven',
    );
    expect(summarize(['ANALYZING', 'CONTRADICTED'])).toBe('0 of 2 proven · 1 analyzing · 1 contradicted');
    expect(summarize([])).toBe('No requirements yet');
  });

  it('spaces 1 to 30 nodes on a ring without any overlap', () => {
    for (let count = 1; count <= 30; count++) {
      const { size, angle } = ringLayout(count, 2.4, 0.2);
      expect(size).toBeGreaterThan(0.1);
      const points = Array.from({ length: count }, (_, i) => [Math.sin(angle(i)) * 2.4, Math.cos(angle(i)) * 2.4] as const);
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const distance = Math.hypot(points[i]![0] - points[j]![0], points[i]![1] - points[j]![1]);
          expect(distance).toBeGreaterThan(size * 2.5);
        }
      }
    }
  });
});
