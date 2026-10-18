import { describe, expect, it } from 'vitest';
import { summary } from '../test/fixtures';
import { CARD_COUNT, cardAt, cardFrame, easeStations, STATION_COUNT, stationAt } from './evidenceLoop';
import { describeInspection } from './inspection';
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
