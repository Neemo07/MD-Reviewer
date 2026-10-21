/**
 * File API tests.
 *
 * Every test runs against a real Express instance bound to an ephemeral port
 * on 127.0.0.1, with a throwaway root folder.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

let server;
let base;
let root;
let outsideDir;

async function api(method, url, body) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, body: json, text };
}

before(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-test-'));
  root = path.join(tmp, 'root');
  outsideDir = path.join(tmp, 'outside');
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'hello.md'), '# Hello\n\nWorld\n', 'utf8');
  fs.writeFileSync(path.join(root, 'sub', 'nested.md'), 'nested content\n', 'utf8');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'not markdown\n', 'utf8');
  fs.writeFileSync(path.join(outsideDir, 'secret.md'), 'TOP SECRET\n', 'utf8');

  const app = createApp({
    root,
    settingsPath: path.join(tmp, 'settings.json'),
    serveClient: false,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('state', () => {
  test('GET /api/state reports the root folder', async () => {
    const res = await api('GET', '/api/state');
    assert.equal(res.status, 200);
    assert.equal(path.resolve(res.body.root), path.resolve(root));
    assert.equal(res.body.rootName, 'root');
  });
});

describe('tree', () => {
  test('lists markdown files only', async () => {
    const res = await api('GET', '/api/tree');
    assert.equal(res.status, 200);
    const names = res.body.tree.map((n) => n.name);
    assert.deepEqual(names, ['sub', 'hello.md']);
    assert.equal(names.includes('notes.txt'), false);
  });
});

describe('read', () => {
  test('reads a markdown file', async () => {
    const res = await api('GET', '/api/file?path=hello.md');
    assert.equal(res.status, 200);
    assert.equal(res.body.content, '# Hello\n\nWorld\n');
    assert.equal(res.body.path, 'hello.md');
  });

  test('reads a nested markdown file', async () => {
    const res = await api('GET', '/api/file?path=sub/nested.md');
    assert.equal(res.status, 200);
    assert.equal(res.body.content, 'nested content\n');
  });

  test('missing file returns 404', async () => {
    const res = await api('GET', '/api/file?path=nope.md');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('non-markdown file is rejected', async () => {
    const res = await api('GET', '/api/file?path=notes.txt');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'BAD_EXTENSION');
  });
});

describe('save', () => {
  test('writes content back to disk', async () => {
    const res = await api('PUT', '/api/file', { path: 'hello.md', content: '# Updated\n' });
    assert.equal(res.status, 200);
    const onDisk = fs.readFileSync(path.join(root, 'hello.md'), 'utf8');
    assert.equal(onDisk, '# Updated\n');
  });

  test('save is atomic - no temp files are left behind', async () => {
    await api('PUT', '/api/file', { path: 'hello.md', content: '# Atomic\n' });
    const leftovers = fs.readdirSync(root).filter((n) => n.includes('.tmp'));
    assert.deepEqual(leftovers, []);
  });

  test('saving a missing file returns 404', async () => {
    const res = await api('PUT', '/api/file', { path: 'ghost.md', content: 'x' });
    assert.equal(res.status, 404);
  });

  test('content must be a string', async () => {
    const res = await api('PUT', '/api/file', { path: 'hello.md', content: 42 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'BAD_CONTENT');
  });

  test('cannot save a non-markdown file', async () => {
    const res = await api('PUT', '/api/file', { path: 'notes.txt', content: 'x' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'BAD_EXTENSION');
  });
});

describe('path traversal protection', () => {
  const traversalCases = [
    ['../outside/secret.md'],
    ['sub/../../outside/secret.md'],
    ['..\\outside\\secret.md'],
    ['./../secret.md'],
    ['sub/../../../../../../etc/passwd'],
  ];

  for (const [badPath] of traversalCases) {
    test(`GET rejects ${JSON.stringify(badPath)}`, async () => {
      const res = await api('GET', `/api/file?path=${encodeURIComponent(badPath)}`);
      assert.equal(res.status, 400, `expected 400 for ${badPath}, got ${res.status}`);
      assert.equal(res.body.error.code, 'PATH_TRAVERSAL');
    });
  }

  const absoluteCases = [
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    'C:/Windows/win.ini',
    '\\\\server\\share\\file.md',
  ];

  for (const badPath of absoluteCases) {
    test(`GET rejects absolute ${JSON.stringify(badPath)}`, async () => {
      const res = await api('GET', `/api/file?path=${encodeURIComponent(badPath)}`);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'BAD_PATH');
    });
  }

  test('PUT cannot escape the root', async () => {
    const res = await api('PUT', '/api/file', { path: '../outside/secret.md', content: 'pwned' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'PATH_TRAVERSAL');
    assert.equal(fs.readFileSync(path.join(outsideDir, 'secret.md'), 'utf8'), 'TOP SECRET\n');
  });

  test('DELETE cannot escape the root', async () => {
    const res = await api('DELETE', '/api/file', { path: '../outside/secret.md' });
    assert.equal(res.status, 400);
    assert.equal(fs.existsSync(path.join(outsideDir, 'secret.md')), true);
  });

  test('POST /api/root rejects a non-folder', async () => {
    const res = await api('POST', '/api/root', { path: path.join(root, 'hello.md') });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'BAD_ROOT');
  });

  test('symlink pointing outside the root is rejected', async (t) => {
    const link = path.join(root, 'escape');
    try {
      fs.symlinkSync(outsideDir, link, 'junction');
    } catch {
      t.skip('symlink creation is not permitted on this machine');
      return;
    }
    const res = await api('GET', '/api/file?path=escape/secret.md');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'PATH_TRAVERSAL');
  });
});

describe('file management', () => {
  const dir = 'manage';

  test('POST /api/file creates a markdown file', async () => {
    const res = await api('POST', '/api/file', { path: `${dir}/new.md`, content: '# New\n' });
    assert.equal(res.status, 201);
    assert.equal(res.body.path, `${dir}/new.md`);
    assert.equal(fs.readFileSync(path.join(root, 'manage', 'new.md'), 'utf8'), '# New\n');
  });

  test('POST /api/file creates a file in the root folder', async () => {
    const res = await api('POST', '/api/file', { path: 'top-level.md' });
    assert.equal(res.status, 201);
    assert.equal(fs.existsSync(path.join(root, 'top-level.md')), true);
    await api('DELETE', '/api/file', { path: 'top-level.md' });
  });

  test('POST /api/file refuses to overwrite an existing file', async () => {
    await api('POST', '/api/file', { path: `${dir}/dup.md`, content: 'first' });
    const res = await api('POST', '/api/file', { path: `${dir}/dup.md`, content: 'second' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'EXISTS');
    assert.equal(fs.readFileSync(path.join(root, 'manage', 'dup.md'), 'utf8'), 'first');
  });

  test('POST /api/file rejects a name without the .md extension', async () => {
    const res = await api('POST', '/api/file', { path: `${dir}/notes.txt` });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'BAD_NAME');
  });

  test('POST /api/file rejects an invalid name', async () => {
    const res = await api('POST', '/api/file', { path: `${dir}/bad*name.md` });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'BAD_NAME');
  });

  test('POST /api/file cannot escape the root folder', async () => {
    const res = await api('POST', '/api/file', { path: '../outside/evil.md' });
    assert.equal(res.status, 400);
    assert.equal(fs.existsSync(path.join(outsideDir, 'evil.md')), false);
  });

  test('POST /api/folder creates a folder', async () => {
    const res = await api('POST', '/api/folder', { path: `${dir}/folder` });
    assert.equal(res.status, 201);
    assert.equal(fs.statSync(path.join(root, 'manage', 'folder')).isDirectory(), true);
  });

  test('POST /api/folder refuses to overwrite an existing folder', async () => {
    const res = await api('POST', '/api/folder', { path: `${dir}/folder` });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'EXISTS');
  });

  test('POST /api/rename renames a file', async () => {
    await api('POST', '/api/file', { path: `${dir}/before.md`, content: 'x' });
    const res = await api('POST', '/api/rename', { path: `${dir}/before.md`, to: `${dir}/after.md` });
    assert.equal(res.status, 200);
    assert.equal(res.body.from, `${dir}/before.md`);
    assert.equal(res.body.to, `${dir}/after.md`);
    assert.equal(fs.existsSync(path.join(root, 'manage', 'before.md')), false);
    assert.equal(fs.existsSync(path.join(root, 'manage', 'after.md')), true);
  });

  test('POST /api/rename refuses to overwrite an existing file', async () => {
    await api('POST', '/api/file', { path: `${dir}/target.md`, content: 'target' });
    const res = await api('POST', '/api/rename', { path: `${dir}/after.md`, to: `${dir}/target.md` });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'EXISTS');
    assert.equal(fs.readFileSync(path.join(root, 'manage', 'target.md'), 'utf8'), 'target');
  });

  test('POST /api/rename refuses to rename a file to a non-markdown name', async () => {
    const res = await api('POST', '/api/rename', { path: `${dir}/after.md`, to: `${dir}/after.txt` });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'BAD_EXTENSION');
  });

  test('POST /api/rename of a missing file returns 404', async () => {
    const res = await api('POST', '/api/rename', { path: `${dir}/ghost.md`, to: `${dir}/ghost2.md` });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('POST /api/rename cannot escape the root folder', async () => {
    const res = await api('POST', '/api/rename', { path: `${dir}/after.md`, to: '../outside/stolen.md' });
    assert.equal(res.status, 400);
    assert.equal(fs.existsSync(path.join(outsideDir, 'stolen.md')), false);
  });

  test('POST /api/rename moves a file into a folder', async () => {
    await api('POST', '/api/file', { path: `${dir}/movable.md`, content: 'x' });
    const res = await api('POST', '/api/rename', { path: `${dir}/movable.md`, to: `${dir}/folder/movable.md` });
    assert.equal(res.status, 200);
    assert.equal(fs.existsSync(path.join(root, 'manage', 'folder', 'movable.md')), true);
  });

  test('DELETE /api/file removes a file', async () => {
    const res = await api('DELETE', '/api/file', { path: `${dir}/new.md` });
    assert.equal(res.status, 200);
    assert.equal(fs.existsSync(path.join(root, 'manage', 'new.md')), false);
  });

  test('DELETE /api/file removes a folder with its content', async () => {
    const res = await api('DELETE', '/api/file', { path: `${dir}/folder` });
    assert.equal(res.status, 200);
    assert.equal(fs.existsSync(path.join(root, 'manage', 'folder')), false);
  });

  test('DELETE /api/file of a missing path returns 404', async () => {
    const res = await api('DELETE', '/api/file', { path: `${dir}/ghost.md` });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('DELETE /api/file cannot delete the root folder', async () => {
    const res = await api('DELETE', '/api/file', { path: '' });
    assert.equal(res.status, 400);
    assert.equal(fs.existsSync(root), true);
  });

  test('DELETE /api/file cannot escape the root folder', async () => {
    const res = await api('DELETE', '/api/file', { path: '../outside/secret.md' });
    assert.equal(res.status, 400);
    assert.equal(fs.existsSync(path.join(outsideDir, 'secret.md')), true);
  });

  test('a renamed file shows up in the tree', async () => {
    const res = await api('GET', '/api/tree');
    const manage = res.body.tree.find((n) => n.name === 'manage');
    assert.ok(manage, 'the manage folder should be listed');
    const names = manage.children.map((n) => n.name).sort();
    assert.deepEqual(names, ['after.md', 'dup.md', 'target.md']);
  });
});

describe('server hardening', () => {
  test('binds to 127.0.0.1 only', async () => {
    const address = server.address();
    assert.equal(address.address, '127.0.0.1');
  });

  test('does not leak the express fingerprint header', async () => {
    const res = await fetch(`${base}/api/state`);
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});
