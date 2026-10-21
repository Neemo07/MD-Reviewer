/**
 * Server-sent events watcher used to detect external changes to the open file.
 *
 * The client subscribes to /api/watch?path=<rel>. When the file changes on
 * disk we push the new content; the client decides whether to reload or to
 * keep its own (dirty) version. Because the payload carries the content, our
 * own saves are naturally ignored by the client (content is identical).
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveInRoot } from './paths.js';

const DEBOUNCE_MS = 180;

/**
 * @param {import('express').Response} res
 * @param {string} root
 * @param {string} relPath
 */
export function watchFile(req, res, root, relPath) {
  const { abs } = resolveInRoot(root, relPath, { mustExist: true, requireMd: true });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  const dir = path.dirname(abs);
  const base = path.basename(abs);
  let timer = null;
  let closed = false;

  const send = (event, data) => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let watcher = null;
  try {
    watcher = fs.watch(dir, (_event, filename) => {
      if (filename && filename.toString() !== base) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        try {
          const stat = fs.statSync(abs);
          if (!stat.isFile()) return;
          const content = fs.readFileSync(abs, 'utf8');
          send('changed', { path: relPath, content, mtimeMs: stat.mtimeMs, size: stat.size });
        } catch {
          send('deleted', { path: relPath });
        }
      }, DEBOUNCE_MS);
    });
  } catch {
    send('error', { message: 'Unable to watch the file.' });
  }

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    if (watcher) watcher.close();
    try { res.end(); } catch { /* ignore */ }
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
  send('ready', { path: relPath });
}
