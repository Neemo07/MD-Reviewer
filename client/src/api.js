/**
 * Thin wrapper around the local file API.
 * Every call returns parsed JSON or throws an Error with `code`/`status`.
 */
async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const error = new Error(data?.error?.message || `Request failed with status ${res.status}.`);
    error.code = data?.error?.code || 'UNKNOWN';
    error.status = res.status;
    throw error;
  }
  return data;
}

const enc = encodeURIComponent;

export const api = {
  getState: () => request('GET', '/api/state'),
  getTree: () => request('GET', '/api/tree'),
  readFile: (path) => request('GET', `/api/file?path=${enc(path)}`),
  saveFile: (path, content) => request('PUT', '/api/file', { path, content }),
  createFile: (path, content = '') => request('POST', '/api/file', { path, content }),
  createFolder: (path) => request('POST', '/api/folder', { path }),
  rename: (path, to) => request('POST', '/api/rename', { path, to }),
  remove: (path) => request('DELETE', '/api/file', { path }),
  getSettings: () => request('GET', '/api/settings'),
  saveSettings: (patch) => request('PUT', '/api/settings', patch),
  setRoot: (path) => request('POST', '/api/root', { path }),

  /** Server sent events stream for external change detection. */
  watch(path, handlers = {}) {
    const source = new EventSource(`/api/watch?path=${enc(path)}`);
    for (const [name, fn] of Object.entries(handlers)) {
      source.addEventListener(name, (event) => {
        let data = null;
        try { data = JSON.parse(event.data); } catch { data = null; }
        fn(data);
      });
    }
    return source;
  },
};
