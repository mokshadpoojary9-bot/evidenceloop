import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEADLINE_LINES, Landing } from './Landing';
import { LOOP_CARDS, LoopFlashcards } from './LoopFlashcards';

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => reduced.value,
}));
vi.mock('../hooks', () => ({ useSystem: () => ({ system: null, error: null }) }));

beforeEach(() => {
  // jsdom has no IntersectionObserver (whileInView needs one).
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  reduced.value = false;
});

const visibleLine = (container: HTMLElement) => {
  const spans = container.querySelectorAll('h1 [aria-hidden] .absolute');
  return spans[spans.length - 1]?.textContent;
};

describe('hero headline', () => {
  it('keeps "Prove the work." fixed, rotates the second line, and gives screen readers one sentence', () => {
    vi.useFakeTimers();
    const { container } = render(<MemoryRouter><Landing /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: "Prove the work. Don't just trust the photo." })).toBeTruthy();
    expect(visibleLine(container)).toBe(HEADLINE_LINES[0]);

    act(() => void vi.advanceTimersByTime(2800));
    expect(visibleLine(container)).toBe(HEADLINE_LINES[1]);
    expect(container.querySelector('h1')!.textContent).toContain('Prove the work.');
    // The accessible name does not change while the line rotates.
    expect(screen.getByRole('heading', { level: 1, name: "Prove the work. Don't just trust the photo." })).toBeTruthy();
  });

  it('shows only the first line with reduced motion', () => {
    reduced.value = true;
    vi.useFakeTimers();
    const { container } = render(<MemoryRouter><Landing /></MemoryRouter>);
    act(() => void vi.advanceTimersByTime(2800 * 3));
    expect(visibleLine(container)).toBe(HEADLINE_LINES[0]);
  });

  it('replaces the chip row with the six flashcards', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>);
    expect(screen.getAllByRole('button', { name: /^Step \d/ })).toHaveLength(6);
  });
});

describe('LoopFlashcards', () => {
  it('has six steps, each with a Room 204 example', () => {
    expect(LOOP_CARDS.map((card) => card.title)).toEqual(['Plan', 'Analyze', 'Guard', 'Request', 'Re-analyze', 'Verify']);
    expect(LOOP_CARDS.every((card) => card.example.startsWith('Room 204'))).toBe(true);
  });

  it('flips on hover, on tap and with Enter or Space, and only the visible face is announced', async () => {
    const user = userEvent.setup();
    render(<LoopFlashcards />);
    const plan = screen.getByRole('button', { name: /Step 1: Plan/ });
    expect(plan.getAttribute('aria-pressed')).toBe('false');
    await user.hover(screen.getByRole('button', { name: /Step 2: Analyze/ }));
    expect(screen.getByRole('button', { name: /Step 2: Analyze/ }).getAttribute('aria-pressed')).toBe('true');
    await user.unhover(screen.getByRole('button', { name: /Step 2: Analyze/ }));

    await user.click(plan);
    expect(plan.getAttribute('aria-pressed')).toBe('true');
    expect(plan.querySelector('[aria-hidden="false"]')!.textContent).toMatch(/six requirements/);

    // Moving the mouse away keeps the tapped card flipped; hover alone flips it back.
    await user.unhover(plan);
    expect(plan.getAttribute('aria-pressed')).toBe('true');
    plan.focus();
    await user.keyboard('{Enter}');
    expect(plan.getAttribute('aria-pressed')).toBe('false');
    await user.keyboard(' ');
    expect(plan.getAttribute('aria-pressed')).toBe('true');
  });
});
