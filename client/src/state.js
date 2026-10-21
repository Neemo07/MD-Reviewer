/**
 * Tiny observable application state.
 */
const listeners = new Map();

export const state = {
  root: '',
  rootName: '',
  file: null,
  baseline: '',
  dirty: false,
  saving: false,
  settings: {
    theme: 'system',
    viewMode: 'split',
    sidebarOpen: true,
    tocOpen: false,
    syncScroll: true,
    autosave: false,
    lastFile: null,
  },
};

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

export function emit(event, payload) {
  for (const handler of listeners.get(event) ?? []) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[md-reader] listener for "${event}" failed`, err);
    }
  }
}

export function setSettings(patch) {
  Object.assign(state.settings, patch);
  emit('settings', state.settings);
}
