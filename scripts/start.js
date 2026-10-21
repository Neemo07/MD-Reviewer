#!/usr/bin/env node
/**
 * `npm start [-- <folder>]` - build the client if needed and run the server.
 *
 * The client is only rebuilt when client/dist is missing or when a source
 * file is newer than the last build, so restarts stay fast.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(root, 'client');
const distDir = path.join(clientDir, 'dist');
const indexFile = path.join(distDir, 'index.html');

function newestMtime(dir, ignoreDirs = new Set(['node_modules', 'dist', '.git'])) {
  let newest = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) stack.push(full);
      } else {
        const mtime = fs.statSync(full).mtimeMs;
        if (mtime > newest) newest = mtime;
      }
    }
  }
  return newest;
}

function buildClient() {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) {
    console.error('[md-reader] vite is not installed. Run: npm install');
    process.exit(1);
  }
  console.log('[md-reader] building the client...');
  const result = spawnSync(process.execPath, [vite, 'build'], {
    cwd: clientDir,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const args = process.argv.slice(2);
const forceBuild = args.includes('--rebuild');
const passthrough = args.filter((arg) => arg !== '--rebuild');

const needsBuild = forceBuild
  || !fs.existsSync(indexFile)
  || newestMtime(path.join(clientDir, 'src')) > fs.statSync(indexFile).mtimeMs;

if (needsBuild) buildClient();
else console.log('[md-reader] using the existing client build');

const serverEntry = path.join(root, 'server', 'src', 'index.js');
const child = spawn(process.execPath, [serverEntry, ...passthrough], {
  cwd: root,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
