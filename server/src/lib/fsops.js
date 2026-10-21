/**
 * Filesystem operations used by the file API.
 *
 * Writes always go through writeFileAtomic (temp file + rename) so that a
 * crash mid-write can never leave a half written file behind.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ApiError, isMarkdown, realRoot } from './paths.js';

const IGNORED_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.obsidian', '__pycache__']);
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

function isHidden(name) {
  return name.startsWith('.');
}

/**
 * Recursively list the folder tree, keeping only markdown files.
 * @returns {{name: string, path: string, type: 'file'|'dir', children?: any[]}[]}
 */
export function listTree(root) {
  const rootAbs = realRoot(root);

  function walk(abs, rel) {
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return [];
    }
    const out = [];
    for (const entry of entries) {
      if (isHidden(entry.name)) continue;
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        // Follow symlinks only while they stay inside the root.
        let real = null;
        try {
          real = fs.realpathSync(childAbs);
        } catch {
          continue;
        }
        const relFromRoot = path.relative(rootAbs, real);
        if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) continue;
        try {
          const stat = fs.statSync(childAbs);
          isDir = stat.isDirectory();
          isFile = stat.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        const children = walk(childAbs, childRel);
        out.push({ name: entry.name, path: childRel, type: 'dir', children });
      } else if (isFile && isMarkdown(entry.name) && !IGNORED_FILES.has(entry.name)) {
        out.push({ name: entry.name, path: childRel, type: 'file' });
      }
    }
    out.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    return out;
  }

  return walk(rootAbs, '');
}

/** Read a markdown file with its metadata. */
export function readFile(root, rel) {
  const abs = path.join(realRoot(root), ...rel.split('/'));
  const stat = fs.statSync(abs);
  const content = fs.readFileSync(abs, 'utf8');
  return {
    path: rel,
    content,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

/**
 * Write a file atomically: write to a temp file in the same folder, fsync,
 * then rename over the target. rename(2) is atomic on POSIX and
 * MoveFileEx(REPLACE_EXISTING) is atomic enough on Windows.
 */
export function writeFileAtomic(root, rel, content) {
  const abs = path.join(realRoot(root), ...rel.split('/'));
  const dir = path.dirname(abs);
  const tmp = path.join(dir, `.${path.basename(abs)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, abs);
  } catch (err) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
  const stat = fs.statSync(abs);
  return { path: rel, size: stat.size, mtimeMs: stat.mtimeMs };
}

/** Create a new markdown file. Fails if the target already exists. */
export function createFile(root, rel, content = '') {
  const abs = path.join(realRoot(root), ...rel.split('/'));
  if (fs.existsSync(abs)) {
    throw new ApiError(409, 'EXISTS', 'A file with that name already exists.');
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  writeFileAtomic(root, rel, content);
  return readFile(root, rel);
}

/** Create a new folder. Fails if the target already exists. */
export function createFolder(root, rel) {
  const abs = path.join(realRoot(root), ...rel.split('/'));
  if (fs.existsSync(abs)) {
    throw new ApiError(409, 'EXISTS', 'A folder with that name already exists.');
  }
  fs.mkdirSync(abs, { recursive: true });
  return { path: rel, type: 'dir' };
}

/** Rename a file or folder. Fails if the destination already exists. */
export function renamePath(root, fromRel, toRel) {
  const fromAbs = path.join(realRoot(root), ...fromRel.split('/'));
  const toAbs = path.join(realRoot(root), ...toRel.split('/'));
  if (!fs.existsSync(fromAbs)) {
    throw new ApiError(404, 'NOT_FOUND', 'File or folder not found.');
  }
  if (fs.existsSync(toAbs)) {
    throw new ApiError(409, 'EXISTS', 'A file or folder with that name already exists.');
  }
  if (fs.statSync(fromAbs).isFile() && !isMarkdown(toRel)) {
    throw new ApiError(400, 'BAD_EXTENSION', 'Only .md files are allowed.');
  }
  fs.mkdirSync(path.dirname(toAbs), { recursive: true });
  fs.renameSync(fromAbs, toAbs);
  return { from: fromRel, to: toRel };
}

/** Delete a file or folder (recursively). */
export function deletePath(root, rel) {
  const abs = path.join(realRoot(root), ...rel.split('/'));
  if (!fs.existsSync(abs)) {
    throw new ApiError(404, 'NOT_FOUND', 'File or folder not found.');
  }
  fs.rmSync(abs, { recursive: true, force: false });
  return { path: rel };
}

/** Validate a name fragment used for new files/folders. */
export function assertValidName(name, { extension } = {}) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new ApiError(400, 'BAD_NAME', 'Name must not be empty.');
  }
  const clean = name.trim();
  if (/[\\/:*?"<>|]/.test(clean)) {
    throw new ApiError(400, 'BAD_NAME', 'Name contains characters that are not allowed.');
  }
  if (clean === '.' || clean === '..') {
    throw new ApiError(400, 'BAD_NAME', 'Name is not valid.');
  }
  if (clean.startsWith('.')) {
    throw new ApiError(400, 'BAD_NAME', 'Name must not start with a dot.');
  }
  if (extension && !clean.toLowerCase().endsWith(extension)) {
    throw new ApiError(400, 'BAD_NAME', `Name must end with ${extension}.`);
  }
  return clean;
}
