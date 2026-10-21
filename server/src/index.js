#!/usr/bin/env node
/**
 * Entry point: parse CLI arguments, start the local server on 127.0.0.1.
 *
 *   node server/src/index.js [--root <folder>] [--port <port>]
 *   npm start -- ./notes
 */
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from './app.js';
import { defaultSettingsPath, createSettingsStore } from './lib/settings.js';

const HOST = '127.0.0.1';

export function parseArgs(argv = process.argv.slice(2)) {
  const options = { root: null, port: Number(process.env.PORT) || 3000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root' || arg === '-r') {
      options.root = argv[++i] ?? null;
    } else if (arg === '--port' || arg === '-p') {
      options.port = Number(argv[++i]) || options.port;
    } else if (arg === '--settings') {
      options.settingsPath = argv[++i] ?? null;
    } else if (!arg.startsWith('-')) {
      options.root = arg;
    }
  }
  return options;
}

function resolveRoot(options) {
  const settings = createSettingsStore(options.settingsPath ?? defaultSettingsPath());
  const candidate = options.root ?? settings.get('lastFolder') ?? process.cwd();
  const abs = path.resolve(candidate);
  if (!fs.existsSync(abs)) {
    console.error(`[md-reader] Folder does not exist: ${abs}`);
    process.exit(1);
  }
  if (!fs.statSync(abs).isDirectory()) {
    console.error(`[md-reader] Not a folder: ${abs}`);
    process.exit(1);
  }
  return abs;
}

const options = parseArgs();
const root = resolveRoot(options);
const settingsPath = options.settingsPath ?? defaultSettingsPath();
const app = createApp({ root, settingsPath });

const server = app.listen(options.port, HOST, () => {
  const address = server.address();
  console.log(`[md-reader] serving ${root}`);
  console.log(`[md-reader] open http://${HOST}:${address.port}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[md-reader] Port ${options.port} is already in use.`);
    process.exit(1);
  }
  throw err;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
