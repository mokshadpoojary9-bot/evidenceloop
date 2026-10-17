import { describe, expect, it } from 'vitest';
import { summary } from '../test/fixtures';
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
