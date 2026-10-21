/**
 * Theme handling: system preference, light, dark.
 * The chosen theme is mirrored into localStorage (instant apply) and into the
 * server settings (shared between the browser and the desktop app).
 */
const STORAGE_KEY = 'md-reader.theme';
const ORDER = ['system', 'light', 'dark'];

const media = window.matchMedia('(prefers-color-scheme: dark)');

function resolve(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return media.matches ? 'dark' : 'light';
}

export function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.resolvedTheme = resolve(theme);
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  return theme;
}

/** @returns {string|null} the stored theme, or null when nothing is stored yet */
export function storedTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return ORDER.includes(value) ? value : null;
  } catch {
    return null;
  }
}

export function nextTheme(theme) {
  const index = ORDER.indexOf(theme);
  return ORDER[(index + 1) % ORDER.length];
}

/** Called when the OS colour scheme changes while "system" is active. */
export function onSystemThemeChange(handler) {
  media.addEventListener('change', () => {
    if (document.documentElement.dataset.theme === 'system') {
      document.documentElement.dataset.resolvedTheme = resolve('system');
      handler?.();
    }
  });
}
