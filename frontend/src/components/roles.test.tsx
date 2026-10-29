import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { summary, system } from '../test/fixtures';
import type { AuditLogEntry, ReviewQueueItem, Viewer } from '../types';
import { AppLayout } from './AppShell';
import { AuditLog } from './AuditLog';
import { ReviewerOnly, ReviewQueue, RoleHome } from './ReviewQueue';

// Technicians and reviewers get separate workspaces. The role always comes from the API.

const apiMock = vi.hoisted(() => ({
  system: vi.fn(),
  reviewQueue: vi.fn(),
  auditLog: vi.fn(),
  listWorkOrders: vi.fn(),
  decideReview: vi.fn(),
}));
vi.mock('../api', () => ({ api: apiMock, serverWake: { subscribe: () => () => {}, isWaking: () => false } }));
vi.mock('../auth', () => ({ useAuth: () => ({ enabled: true, loading: false, session: null, signOut: vi.fn() }) }));
const viewerMock = vi.hoisted(() => ({ viewer: null as Viewer | null, switchDemoRole: vi.fn() }));
vi.mock('../viewer', () => ({ useViewer: () => viewerMock }));

const technician: Viewer = { id: 't1', email: 't@example.com', role: 'technician', roleSource: 'supabase' };
const reviewer: Viewer = { id: 'r1', email: 'r@example.com', role: 'reviewer', roleSource: 'supabase' };

beforeEach(() => {
  apiMock.system.mockResolvedValue(system());
  apiMock.listWorkOrders.mockResolvedValue([summary({ id: 'wo-1', title: 'Replace emergency light in Room 204' })]);
  apiMock.decideReview.mockReset().mockResolvedValue({});
});

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

const navLinks = () =>
  within(screen.getAllByRole('navigation', { name: 'Main' })[0]!)
    .getAllByRole('link')
    .map((link) => link.textContent);

describe('workspaces by role', () => {
  it('gives technicians their own work, with no role switch when signed in with Supabase', () => {
    viewerMock.viewer = technician;
    render(<MemoryRouter initialEntries={['/dashboard']}><AppLayout /></MemoryRouter>);
    expect(navLinks()).toEqual(['Dashboard', 'My work orders', 'New work order', 'About EvidenceLoop']);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('Reviewer')).toBeNull();
  });

  it('gives reviewers the console, marked with the Reviewer badge', () => {
    viewerMock.viewer = reviewer;
    render(<MemoryRouter initialEntries={['/review']}><AppLayout /></MemoryRouter>);
    expect(navLinks()).toEqual(['Review queue', 'All work orders', 'Audit log', 'About EvidenceLoop']);
    expect(screen.getAllByText('Reviewer').length).toBeGreaterThanOrEqual(2); // sidebar and header
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('keeps the role switch for local mode only, labelled Demo mode', () => {
    viewerMock.viewer = { ...technician, roleSource: 'demo' };
    render(<MemoryRouter initialEntries={['/dashboard']}><AppLayout /></MemoryRouter>);
    expect(screen.getByRole('combobox', { name: /Demo mode/ })).toBeTruthy();
  });

  it('sends technicians to the dashboard and reviewers to the review queue after sign-in', () => {
    const routes = (
      <Routes>
        <Route path="home" element={<RoleHome />} />
        <Route path="*" element={<Where />} />
      </Routes>
    );
    viewerMock.viewer = technician;
    const { unmount } = render(<MemoryRouter initialEntries={['/home']}>{routes}</MemoryRouter>);
    expect(screen.getByTestId('where').textContent).toBe('/dashboard');
    unmount();
    viewerMock.viewer = reviewer;
    render(<MemoryRouter initialEntries={['/home']}>{routes}</MemoryRouter>);
    expect(screen.getByTestId('where').textContent).toBe('/review');
  });

  it('keeps technicians out of reviewer pages', () => {
    viewerMock.viewer = technician;
    render(
      <MemoryRouter initialEntries={['/review']}>
        <Routes>
          <Route path="review" element={<ReviewerOnly><p>console</p></ReviewerOnly>} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText('console')).toBeNull();
    expect(screen.getByTestId('where').textContent).toBe('/dashboard');
  });
});

const queueItem = (overrides: Partial<ReviewQueueItem>): ReviewQueueItem => ({
  workOrderId: 'wo-1',
  title: 'Replace emergency light in Room 204',
  location: 'Room 204',
  status: 'IN_REVIEW',
  reason: 'IN_REVIEW',
  simulated: false,
  technician: 'Asha Rao',
  submittedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  submissionNote: 'Indicator hard to see',
  requirementStatuses: ['PROVEN', 'PROVEN', 'UNCERTAIN'],
  canDecide: true,
  blocker: null,
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('ReviewQueue', () => {
  it('lists work orders with technician, submission time and score, and decides with a required note', async () => {
    viewerMock.viewer = reviewer;
    apiMock.reviewQueue.mockResolvedValue([
      queueItem({}),
      queueItem({
        workOrderId: 'wo-2',
        title: 'Fix fire door closer',
        status: 'CONTRADICTED',
        reason: 'CONTRADICTED',
        technician: 'Ben Ortiz',
        submittedAt: null,
        submissionNote: null,
        canDecide: false,
        blocker: 'There is no pending review.',
      }),
    ]);
    const user = userEvent.setup();
    render(<MemoryRouter><ReviewQueue /></MemoryRouter>);

    let first = (await screen.findByRole('link', { name: 'Replace emergency light in Room 204' })).closest('li')!;
    expect(first.textContent).toMatch(/Technician Asha Rao · submitted 2 hours ago/);
    expect(first.textContent).toMatch(/2 \/ 3 proven/);
    const second = screen.getByRole('link', { name: 'Fix fire door closer' }).closest('li')!;
    expect(second.textContent).toMatch(/not submitted for review yet/);
    expect(second.textContent).toMatch(/once the technician submits it/);

    await user.click(screen.getByRole('button', { name: /Contradicted/ }));
    expect(screen.queryByRole('link', { name: 'Replace emergency light in Room 204' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^All/ }));
    first = screen.getByRole('link', { name: 'Replace emergency light in Room 204' }).closest('li')!;

    await user.click(within(first).getByRole('button', { name: 'Approve, reject or request more evidence' }));
    await user.click(within(first).getByText('Reject'));
    const note = within(first).getByLabelText(/Note \(required/);
    expect(note.hasAttribute('required')).toBe(true);
    await user.type(note, 'Wrong unit model in the photo.');
    await user.click(within(first).getByRole('button', { name: 'Reject' }));
    expect(apiMock.decideReview).toHaveBeenCalledWith('wo-1', { decision: 'reject', note: 'Wrong unit model in the photo.' });
  });
});

describe('AuditLog', () => {
  const entry = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
    id: 'e1',
    workOrderId: 'wo-1',
    workOrderTitle: 'Replace emergency light in Room 204',
    type: 'REVIEW_REJECTED',
    summary: 'Rejected by reviewer. Note: Wrong unit model.',
    actor: 'Riya Shah',
    actorRole: 'reviewer',
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  it('shows events across work orders and filters them by type, person and work order', async () => {
    viewerMock.viewer = reviewer;
    apiMock.auditLog.mockResolvedValue([
      entry({}),
      entry({ id: 'e2', type: 'EVIDENCE_UPLOADED', summary: 'Uploaded after photo', actor: 'Asha Rao', actorRole: 'technician' }),
      entry({ id: 'e3', type: 'ANALYSIS_COMPLETED', summary: 'Verification finished', actor: 'Agent', actorRole: 'agent' }),
    ]);
    const user = userEvent.setup();
    render(<MemoryRouter><AuditLog /></MemoryRouter>);

    expect(await screen.findByText('3 of 3 events')).toBeTruthy();
    expect(screen.getByText(/Asha Rao/).textContent).toMatch(/technician/);

    await user.selectOptions(screen.getByLabelText('Event type'), 'review');
    expect(screen.getByText('1 of 3 events')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Event type'), 'all');
    await user.selectOptions(screen.getByLabelText('By'), 'agent');
    expect(screen.getByText('Verification finished')).toBeTruthy();
    expect(screen.queryByText('Uploaded after photo')).toBeNull();
    await user.selectOptions(screen.getByLabelText('By'), 'all');
    await user.type(screen.getByLabelText('Search'), 'after photo');
    expect(screen.getByText('1 of 3 events')).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('Work order'), 'wo-1');
    expect(apiMock.auditLog).toHaveBeenLastCalledWith({ workOrderId: 'wo-1', limit: 200 });
  });
});
