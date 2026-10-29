import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assessment, detail, NO_PERMISSIONS, review, summary, system } from '../test/fixtures';
import type { DashboardData } from '../types';
import { ThemeToggle } from './AppShell';
import { Dashboard } from './Dashboard';
import { EvidenceViewer } from './EvidenceViewer';
import { Landing } from './Landing';
import { Login } from './Login';
import { REQUIREMENT_STATUS, WORK_ORDER_STATUS } from './labels';
import { ReviewPanel } from './ReviewPanel';
import { StatusBadge } from './StatusBadge';
import { AiBanner, AiPill } from './SystemStatus';
import { VerificationOverview } from './VerificationOverview';
import { WorkOrderList } from './WorkOrderList';

const apiMock = vi.hoisted(() => ({
  submitForReview: vi.fn(),
  decideReview: vi.fn(),
  system: vi.fn(() => new Promise(() => {})),
  dashboard: vi.fn(),
  listWorkOrders: vi.fn(),
}));
vi.mock('../api', () => ({
  api: apiMock,
  fileUrl: (url: string | null) => url,
  serverWake: { subscribe: () => () => {}, isWaking: () => false },
}));
const authMock = vi.hoisted(() => ({
  enabled: true,
  loading: false,
  session: null,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../auth', () => ({ useAuth: () => authMock }));
const viewerMock = vi.hoisted(() => ({
  viewer: { id: 'tech', email: null, role: 'technician' as const, roleSource: 'demo' as const },
  switchDemoRole: vi.fn(),
}));
vi.mock('../viewer', () => ({ useViewer: () => viewerMock }));

beforeEach(() => {
  apiMock.submitForReview.mockReset().mockResolvedValue({});
  apiMock.decideReview.mockReset().mockResolvedValue({});
});

describe('AiPill', () => {
  it('says "connected" with the model id only after the live test passed', () => {
    const { rerender } = render(<AiPill system={system()} error={null} />);
    expect(screen.getByText(/NVIDIA Nemotron via Nebius — connected/)).toBeTruthy();
    expect(screen.getByText('nvidia/nemotron-nano-vl')).toBeTruthy();

    rerender(<AiPill system={system({ live: { state: 'failed', vision: false, checkedAt: null, detail: 'x' } })} error={null} />);
    expect(screen.queryByText(/connected/)).toBeNull();
    expect(screen.getByText(/not verified/)).toBeTruthy();

    rerender(<AiPill system={system({ live: { state: 'checking', vision: null, checkedAt: null, detail: null } })} error={null} />);
    expect(screen.queryByText(/— connected/)).toBeNull();
  });

  it('labels the DEV fixture as not AI, and an unconfigured backend as such', () => {
    const { rerender } = render(<AiPill system={system({ mode: 'dev-fixture' })} error={null} />);
    expect(screen.getByText(/DEV fixture · not AI/)).toBeTruthy();
    rerender(<AiPill system={system({ mode: 'unconfigured' })} error={null} />);
    expect(screen.getByText(/Production AI not configured/)).toBeTruthy();
  });

  it('explains a failed live test in the banner', () => {
    render(<AiBanner system={system({ live: { state: 'failed', vision: false, checkedAt: null, detail: 'not vision-capable.' } })} />);
    expect(screen.getByText(/configured but not verified/)).toBeTruthy();
    expect(screen.getByText(/not vision-capable/)).toBeTruthy();
  });
});

describe('StatusBadge', () => {
  it('marks simulated results', () => {
    render(<StatusBadge meta={REQUIREMENT_STATUS.PROVEN} simulated />);
    expect(screen.getByText('Simulated · dev fixture')).toBeTruthy();
  });

  it('never presents a reviewer approval as verified', () => {
    expect(WORK_ORDER_STATUS.APPROVED.label).not.toMatch(/verified/i);
    expect(WORK_ORDER_STATUS.APPROVED.explanation).toMatch(/not AI verification/);
  });
});

describe('ReviewPanel', () => {
  it('lets the technician submit a work order for review', async () => {
    const onChanged = vi.fn();
    render(<ReviewPanel detail={detail({ permissions: { ...NO_PERMISSIONS, submitForReview: true } })} onChanged={onChanged} />);
    await userEvent.type(screen.getByLabelText('Note for the reviewer'), 'Please check');
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    expect(apiMock.submitForReview).toHaveBeenCalledWith('wo-1', 'Please check');
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows a waiting technician why they cannot decide', () => {
    render(
      <ReviewPanel
        detail={detail({ reviews: [review()], permissions: { ...NO_PERMISSIONS, reasons: { review: 'Only reviewers can decide reviews.' } } })}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByText('Only reviewers can decide reviews.')).toBeTruthy();
    expect(screen.queryByText('Your decision')).toBeNull();
  });

  it('lets a reviewer approve with a note, warning that approval is not verification', async () => {
    render(<ReviewPanel detail={detail({ reviews: [review()], permissions: { ...NO_PERMISSIONS, review: true } })} onChanged={() => {}} />);
    expect(screen.getByText(/Approval is your decision, not AI verification/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/Note \(required/), 'Checked on site');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(apiMock.decideReview).toHaveBeenCalledWith('wo-1', { decision: 'approve', note: 'Checked on site' });
  });

  it('sends the evidence request when a reviewer asks for more evidence', async () => {
    render(<ReviewPanel detail={detail({ reviews: [review()], permissions: { ...NO_PERMISSIONS, review: true } })} onChanged={() => {}} />);
    await userEvent.click(screen.getByText('Request more evidence', { selector: 'label' }));
    await userEvent.selectOptions(screen.getByLabelText('Evidence type'), 'additional_photo');
    await userEvent.type(screen.getByLabelText('Exactly what is needed'), 'Close-up of the indicator');
    await userEvent.type(screen.getByLabelText(/Note \(required/), 'Need proof');
    await userEvent.click(screen.getByRole('button', { name: 'Request more evidence' }));
    expect(apiMock.decideReview).toHaveBeenCalledWith('wo-1', {
      decision: 'request_evidence',
      note: 'Need proof',
      request: { kind: 'additional_photo', instruction: 'Close-up of the indicator' },
    });
  });

  it('renders nothing when there is nothing to review', () => {
    const { container } = render(<ReviewPanel detail={detail()} onChanged={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('EvidenceViewer', () => {
  const withObservation = detail({
    requirements: [
      {
        ...detail().requirements[0]!,
        assessment: assessment({
          observations: [
            { evidenceId: 'ev-video', kind: 'direct', text: 'The lamp lights after the button press.', startSec: 4, endSec: 7 },
          ],
        }),
      },
    ],
  });

  it('shows metadata, what the AI can inspect, and the observations citing the file', () => {
    render(
      <MemoryRouter>
        <EvidenceViewer detail={withObservation} aiMode="nebius" target={{ evidenceId: 'ev-video' }} onNavigate={() => {}} onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'test.mp4' })).toBeTruthy();
    expect(screen.getByText('a'.repeat(64))).toBeTruthy();
    expect(screen.getByText(/Up to 8 still frames/)).toBeTruthy();
    expect(screen.getByText(/the soundtrack/)).toBeTruthy();
    expect(screen.getByText('The lamp lights after the button press.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '0:04–0:07' })).toBeTruthy();
    expect(screen.getByText(/a claim, not proof/)).toBeTruthy();
  });

  it('is closed when nothing is selected', () => {
    render(<EvidenceViewer detail={withObservation} aiMode="nebius" target={null} onNavigate={() => {}} onClose={() => {}} />);
    expect(screen.queryByText('test.mp4')).toBeNull();
  });
});

describe('Login', () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText('Email'), 'tech@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret-password1');
  };

  it('tells a new user to confirm their email after sign-up', async () => {
    authMock.signUp.mockReset().mockResolvedValue({ error: null, confirmEmail: true });
    const user = userEvent.setup();
    render(<MemoryRouter><Login /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /Need an account/ }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(authMock.signUp).toHaveBeenCalledWith('tech@example.com', 'secret-password1');
    expect(screen.getByRole('heading', { name: 'Check your email to confirm your account' })).toBeTruthy();
    expect(screen.getByText('tech@example.com')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('shows sign-in errors', async () => {
    authMock.signIn.mockReset().mockResolvedValue('Your email address is not confirmed yet.');
    const user = userEvent.setup();
    render(<MemoryRouter><Login /></MemoryRouter>);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Your email address is not confirmed yet.')).toBeTruthy();
  });

  it('checks the email and the new password inline before signing up', async () => {
    authMock.signUp.mockReset();
    const user = userEvent.setup();
    render(<MemoryRouter><Login /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /Need an account/ }));
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(authMock.signUp).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/Enter a valid email address/)).toBeTruthy();
    expect(screen.getByText('Use at least 8 characters.')).toBeTruthy();

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'longenough');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(screen.getByText('Include at least one number.')).toBeTruthy();
    expect(authMock.signUp).not.toHaveBeenCalled();
  });

  it('starts Google sign-in with the requested return address', async () => {
    authMock.signInWithGoogle.mockReset().mockResolvedValue(null);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/login?next=%2Fwork-orders']}><Login /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(authMock.signInWithGoogle).toHaveBeenCalledWith('/work-orders');
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy');
  });
});

describe('Landing hero', () => {
  it('shows the headline, the dashboard link and the 2D loop when WebGL is unavailable', () => {
    // jsdom has no IntersectionObserver (framer-motion's whileInView needs one).
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    render(<MemoryRouter><Landing /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: "Prove the work. Don't just trust the photo." })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open dashboard/ }).getAttribute('href')).toBe('/dashboard');
    // jsdom has no WebGL, so the SVG version of the same loop is shown, described for screen readers.
    expect(screen.getByRole('img', { name: /evidence loop.*Upload, Analyze, Map to requirement, Decide, Request more, Re-analyze/ })).toBeTruthy();
    expect(screen.getAllByRole('listitem', { current: 'step' })).toHaveLength(1);
    expect(screen.getByText(/arrive as evidence/)).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

describe('VerificationOverview', () => {
  it('draws the 2D graph when WebGL is unavailable, with working nodes and a summary', async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const user = userEvent.setup();
    const onSelectRequirement = vi.fn();
    const onOpenEvidence = vi.fn();
    const base = detail();
    const data = detail({
      requirements: [
        { ...base.requirements[0]!, assessment: assessment({ observations: [{ evidenceId: 'ev-video', kind: 'direct', text: 'Lamp lights', startSec: 2, endSec: 4 }] }) },
        { ...base.requirements[0]!, id: 'req-2', position: 2, title: 'Securely mounted', status: 'UNCERTAIN', assessment: null },
      ],
      requests: [
        { id: 'r1', workOrderId: 'wo-1', runId: null, requestedBy: 'agent', requirementIds: ['req-2'], kind: 'after_photo', instruction: 'Photo of the bracket', status: 'OPEN', fulfilledByEvidenceId: null, createdAt: '', updatedAt: '' },
      ],
    });
    render(<VerificationOverview detail={data} coreHex="#fbbf24" onSelectRequirement={onSelectRequirement} onOpenEvidence={onOpenEvidence} />);

    expect(screen.getByText('1 of 2 proven · 1 uncertain')).toBeTruthy();
    expect(document.querySelector('canvas')).toBeNull();
    const graph = screen.getByRole('group', { name: /Verification graph: 1 of 2 proven/ });
    expect(graph.querySelectorAll('line')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /Requirement 2, Securely mounted: Uncertain, evidence requested/ }));
    expect(onSelectRequirement).toHaveBeenCalledWith('req-2');
    await user.click(screen.getByRole('button', { name: 'Open Video: test.mp4' }));
    expect(onOpenEvidence).toHaveBeenCalledWith('ev-video');

    await user.click(screen.getByRole('button', { name: 'Hide graph' }));
    expect(screen.queryByRole('group', { name: /Verification graph/ })).toBeNull();
    expect(screen.getByText('1 of 2 proven · 1 uncertain')).toBeTruthy();
    getContext.mockRestore();
  });
});

describe('Dashboard', () => {
  const data: DashboardData = {
    counts: { VERIFIED: 2, NEEDS_EVIDENCE: 1, IN_REVIEW: 1, CONTRADICTED: 0, AWAITING_EVIDENCE: 3 },
    openRequests: [
      {
        id: 'r1',
        workOrderId: 'wo-1',
        workOrderTitle: 'Replace emergency light in Room 204',
        kind: 'video',
        instruction: 'Upload a 5–10 second video showing the emergency light functional test.',
        requirementTitles: ['Functional test completed'],
        createdAt: new Date().toISOString(),
      },
    ],
    awaitingReview: [{ workOrderId: 'wo-2', title: 'Fix fire door closer', location: 'Stair B', submittedAt: new Date().toISOString() }],
    activity: [
      {
        id: 'a1',
        workOrderId: 'wo-1',
        workOrderTitle: 'Replace emergency light in Room 204',
        type: 'DECISION',
        summary: 'Functional test completed: NOT_PROVEN',
        actor: 'Agent',
        createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
    ],
  };

  it('shows counts that link to the filtered list, what needs action, and recent activity', async () => {
    apiMock.dashboard.mockResolvedValue(data);
    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    const verified = await screen.findByRole('link', { name: '2 Verified: show these work orders' });
    expect(verified.getAttribute('href')).toBe('/work-orders?status=VERIFIED');
    expect(screen.getByRole('link', { name: '3 Draft: show these work orders' }).getAttribute('href')).toBe(
      '/work-orders?status=AWAITING_EVIDENCE',
    );
    expect(screen.getByRole('link', { name: /New work order/ }).getAttribute('href')).toBe('/work-orders/new');

    const action = screen.getByRole('region', { name: /Needs your action/ });
    expect(within(action).getByText(/functional test\./)).toBeTruthy();
    expect(within(action).getByText(/Waiting for a reviewer/)).toBeTruthy();

    const activity = screen.getByRole('region', { name: /Recent activity/ });
    const row = within(activity).getByText('Functional test completed: NOT_PROVEN').closest('a')!;
    expect(row.textContent).toMatch(/5 minutes ago · Agent · Replace emergency light in Room 204/);
    expect(row.getAttribute('href')).toBe('/work-orders/wo-1');
  });

  it('offers a retry when the dashboard cannot load', async () => {
    apiMock.dashboard.mockRejectedValueOnce(new Error('API offline')).mockResolvedValueOnce(data);
    const user = userEvent.setup();
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not load the dashboard: API offline/);
    await user.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByRole('link', { name: '2 Verified: show these work orders' })).toBeTruthy();
  });
});

describe('WorkOrderList', () => {
  function LocationProbe() {
    const location = useLocation();
    return <output data-testid="location">{location.search}</output>;
  }

  it('filters by the status in the URL, and writes a new status back to the URL', async () => {
    apiMock.listWorkOrders.mockResolvedValue([
      summary({ id: 'a', title: 'Replace emergency light', status: 'VERIFIED' }),
      summary({ id: 'b', title: 'Fix fire door closer', status: 'NEEDS_EVIDENCE' }),
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/work-orders?status=VERIFIED']}>
        <Routes>
          <Route path="/work-orders" element={<><WorkOrderList /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Replace emergency light')).toBeTruthy();
    expect(screen.queryByText('Fix fire door closer')).toBeNull();

    await user.selectOptions(screen.getByLabelText('Status'), 'NEEDS_EVIDENCE');
    expect(screen.getByTestId('location').textContent).toBe('?status=NEEDS_EVIDENCE');
    expect(screen.getByText('Fix fire door closer')).toBeTruthy();
    expect(screen.queryByText('Replace emergency light')).toBeNull();
  });
});

describe('ThemeToggle', () => {
  it('switches between dark and light and remembers the choice', async () => {
    document.documentElement.dataset.theme = 'dark';
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('evidenceloop.theme')).toBe('light');
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
