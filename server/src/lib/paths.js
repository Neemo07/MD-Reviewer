/**
 * Path safety helpers.
 *
 * Every request that touches the filesystem goes through this module. The
 * contract is simple: a caller supplies a *relative* path, and we either hand
 * back a path that is provably inside the root folder, or we throw.
 *
 * Rejected:
 *   - absolute paths            (/etc/passwd, C:\Windows, \\server\share)
 *   - parent traversal          (../secret.md, a/../../b.md)
 *   - NUL bytes                 (truncation attacks)
 *   - symlinks that leave root  (checked via realpath)
 */
import fs from 'node:fs';
import path from 'node:path';

export const MD_EXT = '.md';

/** Error type carrying an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const DRIVE_RE = /^[a-zA-Z]:/;

/** True for anything that looks absolute on Windows or POSIX. */
export function looksAbsolute(input) {
  if (typeof input !== 'string') return true;
  return (
    input.startsWith('/') ||
    input.startsWith('\\') ||
    DRIVE_RE.test(input) ||
    path.isAbsolute(input)
  );
}

/**
 * Normalise a client supplied relative path.
 * Throws ApiError for anything malformed or trying to escape.
 */
export function normalizeRelative(input) {
  if (typeof input !== 'string') {
    throw new ApiError(400, 'BAD_PATH', 'Path must be a string.');
  }
  const raw = input.trim();
  if (!raw) {
    throw new ApiError(400, 'BAD_PATH', 'Path must not be empty.');
  }
  if (raw.includes('\0')) {
    throw new ApiError(400, 'BAD_PATH', 'Path contains invalid characters.');
  }
  if (looksAbsolute(raw)) {
    throw new ApiError(400, 'BAD_PATH', 'Absolute paths are not allowed.');
  }
  const parts = raw.replace(/\\/g, '/').split('/');
  const clean = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      throw new ApiError(400, 'PATH_TRAVERSAL', 'Path traversal is not allowed.');
    }
    clean.push(part);
  }
  if (!clean.length) {
    throw new ApiError(400, 'BAD_PATH', 'Path must not be empty.');
  }
  return clean.join('/');
}

/** Root with symlinks resolved; falls back to a resolved path if it is missing. */
export function realRoot(root) {
  const abs = path.resolve(root);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

/** True when `target` is `root` itself or lives underneath it. */
export function isInside(root, target) {
  const rel = path.relative(root, target);
  if (rel === '') return true;
  return !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
}

/**
 * Resolve a client path to an absolute path inside `root`.
 *
 * @param {string} root       absolute root folder
 * @param {string} input      client supplied relative path
 * @param {object} [options]
 * @param {boolean} [options.mustExist=false]  fail with 404 when missing
 * @param {boolean} [options.allowDir=false]   allow the target to be a folder
 * @param {boolean} [options.requireMd=false]  require a .md extension
 * @returns {{rel: string, abs: string}}
 */
export function resolveInRoot(root, input, options = {}) {
  const { mustExist = false, allowDir = false, requireMd = false } = options;
  const rel = normalizeRelative(input);
  const rootAbs = realRoot(root);
  const abs = path.resolve(rootAbs, ...rel.split('/'));

  if (!isInside(rootAbs, abs)) {
    throw new ApiError(400, 'PATH_TRAVERSAL', 'Path escapes the root folder.');
  }

  // Symlink guard: resolve the nearest existing ancestor and make sure the
  // real location is still inside the root. This catches symlinked folders
  // pointing outside the root even when the final segment does not exist yet.
  let probe = abs;
  let realProbe = null;
  for (;;) {
    if (fs.existsSync(probe)) {
      try {
        realProbe = fs.realpathSync(probe);
      } catch {
        realProbe = null;
      }
      break;
    }
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (realProbe && !isInside(rootAbs, realProbe)) {
    throw new ApiError(400, 'PATH_TRAVERSAL', 'Path escapes the root folder (symlink).');
  }

  if (requireMd && !isMarkdown(rel)) {
    throw new ApiError(400, 'BAD_EXTENSION', 'Only .md files are allowed.');
  }

  const exists = fs.existsSync(abs);
  if (mustExist && !exists) {
    throw new ApiError(404, 'NOT_FOUND', 'File not found.');
  }
  // `allowDir` means "this route may also address folders". Without it the
  // target has to be a regular file.
  if (exists && !allowDir && !fs.statSync(abs).isFile()) {
    throw new ApiError(400, 'NOT_A_FILE', 'Path is not a file.');
  }

  return { rel, abs };
}

/** True when a relative path points at a markdown file. */
export function isMarkdown(rel) {
  return path.extname(rel).toLowerCase() === MD_EXT;
}

/** Convert a platform path to a forward-slash relative path for the API. */
export function toPosix(rel) {
  return rel.split(path.sep).join('/');
}
