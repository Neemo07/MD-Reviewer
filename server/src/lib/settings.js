/**
 * Persisted user settings (last folder, theme, view mode, sidebar state).
 *
 * Stored outside the user's notes folder so that reading a folder never
 * writes anything into it.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEFAULT_SETTINGS = {
  lastFolder: null,
  lastFile: null,
  theme: 'system',
  viewMode: 'split',
  sidebarOpen: true,
  tocOpen: false,
  syncScroll: true,
  autosave: false,
};

export function defaultSettingsPath() {
  return path.join(os.homedir(), '.mdreader', 'settings.json');
}

export function createSettingsStore(settingsPath = defaultSettingsPath()) {
  let data = { ...DEFAULT_SETTINGS };

  function load() {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        data = { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {
      data = { ...DEFAULT_SETTINGS };
    }
    return data;
  }

  function persist() {
    try {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // Settings are a convenience; never fail a request because of them.
    }
  }

  load();

  return {
    path: settingsPath,
    get(key) {
      return key === undefined ? { ...data } : data[key];
    },
    set(patch) {
      if (patch && typeof patch === 'object') {
        for (const [key, value] of Object.entries(patch)) {
          if (key in DEFAULT_SETTINGS) data[key] = value;
        }
      }
      persist();
      return { ...data };
    },
  };
}
