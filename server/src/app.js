/**
 * Express application: static UI + the local file API.
 *
 * The API is intentionally tiny and every route funnels its path through
 * server/src/lib/paths.js so the sandbox rules cannot be bypassed by using a
 * different endpoint.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, resolveInRoot, realRoot } from './lib/paths.js';
import * as fsops from './lib/fsops.js';
import { createSettingsStore, defaultSettingsPath } from './lib/settings.js';
import { watchFile } from './lib/watcher.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(here, '../../client/dist');

/**
 * @param {object} [options]
 * @param {string} [options.root]        root folder to expose
 * @param {string} [options.settingsPath] where settings are persisted
 * @param {boolean} [options.serveClient] serve the built client (default true)
 */
export function createApp(options = {}) {
  const { settingsPath = defaultSettingsPath(), serveClient = true } = options;
  const settings = createSettingsStore(settingsPath);
  const state = { root: path.resolve(options.root ?? settings.get('lastFolder') ?? process.cwd()) };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32mb' }));

  const api = express.Router();

  function requirePath(input, opts = {}) {
    return resolveInRoot(state.root, input, opts);
  }

  function sendError(res, err) {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    const message = err && err.message ? err.message : 'Unexpected server error.';
    return res.status(500).json({ error: { code: 'INTERNAL', message } });
  }

  /** Wrap an async handler so rejections reach the error middleware. */
  const route = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

  // --- state -------------------------------------------------------------
  api.get('/state', (req, res) => {
    res.json({
      root: state.root,
      rootName: path.basename(realRoot(state.root)) || state.root,
      settings: settings.get(),
      version: 1,
    });
  });

  api.get('/settings', (req, res) => {
    res.json(settings.get());
  });

  api.put('/settings', (req, res) => {
    res.json(settings.set(req.body || {}));
  });

  /** Switch the exposed root folder (used by the desktop folder picker). */
  api.post('/root', route((req, res) => {
    const next = req.body?.path;
    if (typeof next !== 'string' || !next.trim()) {
      throw new ApiError(400, 'BAD_PATH', 'A folder path is required.');
    }
    const abs = path.resolve(next.trim());
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      throw new ApiError(400, 'BAD_ROOT', 'Folder does not exist.');
    }
    state.root = abs;
    settings.set({ lastFolder: abs });
    res.json({ root: state.root, rootName: path.basename(abs) || abs });
  }));

  // --- tree --------------------------------------------------------------
  api.get('/tree', (req, res) => {
    res.json({ root: state.root, tree: fsops.listTree(state.root) });
  });

  // --- files -------------------------------------------------------------
  api.get('/file', route((req, res) => {
    const { rel } = requirePath(req.query.path, { mustExist: true, requireMd: true });
    res.json(fsops.readFile(state.root, rel));
  }));

  /**
   * Serve an asset (image, pdf, text) that lives inside the root folder so
   * that relative images and links in the preview resolve. Only a small set
   * of inert content types is allowed and the response is sandboxed.
   */
  api.get('/raw', route((req, res) => {
    const { rel, abs } = requirePath(req.query.path, { mustExist: true });
    const types = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.avif': 'image/avif',
      '.bmp': 'image/bmp',
      '.ico': 'image/x-icon',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain; charset=utf-8',
      '.md': 'text/plain; charset=utf-8',
    };
    const type = types[path.extname(rel).toLowerCase()];
    if (!type) {
      throw new ApiError(400, 'BAD_TYPE', 'Unsupported file type.');
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': fs.statSync(abs).size,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(abs).pipe(res);
  }));

  /** Save an existing file. */
  api.put('/file', route((req, res) => {
    const { rel } = requirePath(req.body?.path, { requireMd: true });
    const content = req.body?.content;
    if (typeof content !== 'string') {
      throw new ApiError(400, 'BAD_CONTENT', 'Content must be a string.');
    }
    if (!fs.existsSync(path.join(realRoot(state.root), ...rel.split('/')))) {
      throw new ApiError(404, 'NOT_FOUND', 'File not found.');
    }
    res.json(fsops.writeFileAtomic(state.root, rel, content));
  }));

  /** Create a new file. */
  api.post('/file', route((req, res) => {
    const raw = req.body?.path;
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new ApiError(400, 'BAD_PATH', 'A file path is required.');
    }
    const name = fsops.assertValidName(path.basename(raw.replace(/\\/g, '/')), { extension: '.md' });
    const dir = path.dirname(raw.replace(/\\/g, '/')).replace(/\\/g, '/');
    const rel = dir && dir !== '.' ? `${dir}/${name}` : name;
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    requirePath(rel, { requireMd: true });
    res.status(201).json(fsops.createFile(state.root, rel, content));
  }));

  /** Create a new folder. */
  api.post('/folder', route((req, res) => {
    const raw = req.body?.path;
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new ApiError(400, 'BAD_PATH', 'A folder path is required.');
    }
    const name = fsops.assertValidName(path.basename(raw.replace(/\\/g, '/')));
    const dir = path.dirname(raw.replace(/\\/g, '/')).replace(/\\/g, '/');
    const rel = dir && dir !== '.' ? `${dir}/${name}` : name;
    requirePath(rel, { allowDir: true });
    res.status(201).json(fsops.createFolder(state.root, rel));
  }));

  /** Rename a file or folder. */
  api.post('/rename', route((req, res) => {
    const from = req.body?.path;
    const to = req.body?.to;
    if (typeof from !== 'string' || typeof to !== 'string') {
      throw new ApiError(400, 'BAD_PATH', 'Both path and to are required.');
    }
    const { rel: fromRel } = requirePath(from, { allowDir: true });
    const toNorm = to.replace(/\\/g, '/').replace(/\/+$/, '');
    const name = fsops.assertValidName(path.basename(toNorm));
    const dir = path.dirname(toNorm).replace(/\\/g, '/');
    const toRel = dir && dir !== '.' ? `${dir}/${name}` : name;
    requirePath(toRel, { allowDir: true });
    res.json(fsops.renamePath(state.root, fromRel, toRel));
  }));

  /** Delete a file or folder. */
  api.delete('/file', route((req, res) => {
    const { rel } = requirePath(req.body?.path ?? req.query.path, { allowDir: true });
    res.json(fsops.deletePath(state.root, rel));
  }));

  // --- change notifications ---------------------------------------------
  api.get('/watch', route((req, res) => {
    const { rel } = requirePath(req.query.path, { mustExist: true, requireMd: true });
    watchFile(req, res, state.root, rel);
  }));

  app.use('/api', api);

  // --- static client -----------------------------------------------------
  if (serveClient) {
    // Hashed assets are cached aggressively, the shell never is.
    app.use(express.static(CLIENT_DIST, {
      index: false,
      maxAge: '1y',
      immutable: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      const indexFile = path.join(CLIENT_DIST, 'index.html');
      if (!fs.existsSync(indexFile)) {
        return res.status(503).type('text/plain').send(
          'The client has not been built yet.\n\nRun:  npm run build\n',
        );
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
  }

  // --- error handling ----------------------------------------------------
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    sendError(res, err);
  });

  app.locals.getRoot = () => state.root;
  app.locals.setRoot = (nextRoot) => {
    state.root = path.resolve(nextRoot);
    settings.set({ lastFolder: state.root });
    return state.root;
  };

  return app;
}
