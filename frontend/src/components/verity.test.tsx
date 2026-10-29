import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Markdown, parseBlocks } from '../lib/markdown';
import { system } from '../test/fixtures';
import type { Viewer } from '../types';
import { useVerity, VerityProvider } from '../verity';
import { AppLayout } from './AppShell';
import { VerityPanel } from './VerityPanel';

const apiMock = vi.hoisted(() => ({
  askVerity: vi.fn(),
  system: vi.fn(),
}));
vi.mock('../api', () => ({
  api: { system: apiMock.system },
  askVerity: apiMock.askVerity,
  serverWake: { subscribe: () => () => {}, isWaking: () => false },
}));
vi.mock('../auth', () => ({ useAuth: () => ({ enabled: true, loading: false, session: null, signOut: vi.fn() }) }));
const technician: Viewer = { id: 't1', email: 't@example.com', role: 'technician', roleSource: 'supabase' };
vi.mock('../viewer', () => ({ useViewer: () => ({ viewer: technician, switchDemoRole: vi.fn() }) }));

beforeEach(() => {
  apiMock.system.mockResolvedValue(system());
  apiMock.askVerity.mockReset();
});

describe('Verity in the app shell', () => {
  it('replaces "About EvidenceLoop" in the sidebar with Ask Verity, and keeps About in the footer', () => {
    render(<MemoryRouter initialEntries={['/dashboard']}><AppLayout /></MemoryRouter>);
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]!;
    expect(within(nav).queryByText('About EvidenceLoop')).toBeNull();
    expect(within(nav).getByRole('button', { name: /Ask Verity/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'About EvidenceLoop' }).getAttribute('href')).toBe('/');
    // No floating button away from a work order page.
    expect(screen.getAllByRole('button', { name: /Ask Verity/ })).toHaveLength(1);
  });

  it('shows a floating Ask Verity button on a work order page and opens the panel there', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/work-orders/11111111-1111-4111-8111-111111111111']}>
        <AppLayout />
      </MemoryRouter>,
    );
    const buttons = screen.getAllByRole('button', { name: /Ask Verity/ });
    expect(buttons).toHaveLength(2); // sidebar + floating
    await user.click(buttons[1]!);
    expect(await screen.findByRole('heading', { name: 'Verity' })).toBeTruthy();
    expect(screen.getByText('Your verification co-pilot', { selector: 'p' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Why is this work order not verified?' })).toBeTruthy();
  });
});

describe('VerityPanel', () => {
  function Opened({ workOrderId = null }: { workOrderId?: string | null }) {
    return (
      <VerityProvider workOrderId={workOrderId}>
        <OpenOnMount />
        <VerityPanel />
      </VerityProvider>
    );
  }
  function OpenOnMount() {
    // The provider starts closed; open it as the sidebar button would.
    const { open } = useVerity();
    useEffect(open, [open]);
    return null;
  }

  it('streams an answer for a suggested question, renders Markdown, and offers copy and the footnote', async () => {
    apiMock.askVerity.mockImplementation(async (_body, onDelta: (text: string) => void) => {
      onDelta('Room 204 is **not verified**:\n');
      onDelta('- #5 Indicator functioning: UNCERTAIN');
    });
    const user = userEvent.setup();
    render(<Opened workOrderId="wo-1" />);

    await user.click(screen.getByRole('button', { name: 'What evidence is missing?' }));
    expect(apiMock.askVerity).toHaveBeenCalledWith(
      { messages: [{ role: 'user', content: 'What evidence is missing?' }], workOrderId: 'wo-1' },
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect((await screen.findByText('not verified')).tagName).toBe('STRONG');
    expect(screen.getByRole('listitem').textContent).toBe('#5 Indicator functioning: UNCERTAIN');
    expect(screen.getByRole('button', { name: 'Copy answer' })).toBeTruthy();
    expect(screen.getByText(/Verity can make mistakes — check the evidence\./)).toBeTruthy();
  });

  it('shows a clear error when Verity cannot answer, and sends the conversation so far', async () => {
    apiMock.askVerity
      .mockImplementationOnce(async (_body, onDelta: (text: string) => void) => onDelta('First answer.'))
      .mockRejectedValueOnce(new Error('Verity is busy right now: the AI service is rate-limited (429). Try again in a minute.'));
    const user = userEvent.setup();
    render(<Opened />);

    await user.type(screen.getByLabelText('Ask Verity'), 'Summarize today{Enter}');
    await screen.findByText('First answer.');
    await user.type(screen.getByLabelText('Ask Verity'), 'And yesterday?{Enter}');
    expect((await screen.findByRole('alert')).textContent).toMatch(/rate-limited \(429\)/);
    expect(apiMock.askVerity.mock.calls[1]![0].messages).toEqual([
      { role: 'user', content: 'Summarize today' },
      { role: 'assistant', content: 'First answer.' },
      { role: 'user', content: 'And yesterday?' },
    ]);
  });
});

describe('Markdown', () => {
  it('renders a safe subset: no raw HTML, only http(s) links', () => {
    const { container } = render(
      <Markdown text={'<img src=x onerror=alert(1)> **bold** [ok](https://example.com) [bad](javascript:alert(1))\n\n1. one\n2. two'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.querySelector('a')!.getAttribute('href')).toBe('https://example.com');
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('groups lines into paragraphs, lists and headings', () => {
    expect(parseBlocks('## Status\nLine one\nline two\n\n- a\n- b').map((block) => block.kind)).toEqual(['h', 'p', 'ul']);
  });
});
