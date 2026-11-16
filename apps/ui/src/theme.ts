export type Theme = 'light' | 'dark';

const KEY = 'zeniconic-theme';

export function getStoredTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme): void {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode */
  }
}
