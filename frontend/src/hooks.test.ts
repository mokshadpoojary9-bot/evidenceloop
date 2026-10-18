import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePolling } from './hooks';

let visibility: DocumentVisibilityState = 'visible';
const setVisibility = (value: DocumentVisibilityState) => {
  visibility = value;
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('usePolling', () => {
  it('polls on its interval while the tab is visible', () => {
    const poll = vi.fn();
    renderHook(() => usePolling(poll, 5000, true));
    vi.advanceTimersByTime(4999);
    expect(poll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(poll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('stops while the tab is hidden, and catches up once when it is shown again', () => {
    const poll = vi.fn();
    renderHook(() => usePolling(poll, 5000, true));
    setVisibility('hidden');
    vi.advanceTimersByTime(30_000);
    expect(poll).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(poll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('does not start in a hidden tab, or at all when disabled', () => {
    const poll = vi.fn();
    visibility = 'hidden';
    renderHook(() => usePolling(poll, 5000, true));
    renderHook(() => usePolling(poll, 5000, false));
    vi.advanceTimersByTime(30_000);
    expect(poll).not.toHaveBeenCalled();
  });

  it('stops on unmount', () => {
    const poll = vi.fn();
    const { unmount } = renderHook(() => usePolling(poll, 5000, true));
    unmount();
    vi.advanceTimersByTime(30_000);
    setVisibility('visible');
    expect(poll).not.toHaveBeenCalled();
  });
});
