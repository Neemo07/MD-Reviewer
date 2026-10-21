#!/usr/bin/env node
/**
 * `npm run dev` - Vite dev server (hot reload) plus the API server.
 *
 * The Vite dev server proxies /api to the Express server on port 3000.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const serverEntry = path.join(root, 'server', 'src', 'index.js');
const passthrough = process.argv.slice(2);

const children = [];

function run(name, command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false });
  child.on('exit', (code) => {
    console.log(`[md-reader] ${name} exited with code ${code}`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    try { child.kill(); } catch { /* ignore */ }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (!fs.existsSync(vite)) {
  console.error('[md-reader] vite is not installed. Run: npm install');
  process.exit(1);
}

run('vite', process.execPath, [vite, '--host', '127.0.0.1'], path.join(root, 'client'));
run('server', process.execPath, [serverEntry, ...passthrough], root);
