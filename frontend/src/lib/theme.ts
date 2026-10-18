import { useCallback, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'evidenceloop.theme';

/** The theme index.html applied before first paint (saved choice, else system preference). */
function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** Light/dark mode. The choice is remembered when storage is available. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const toggle = useCallback(() => {
    const next: Theme = currentTheme() === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // storage unavailable: the choice applies to this page load
    }
    setTheme(next);
  }, []);
  return { theme, toggle };
}
