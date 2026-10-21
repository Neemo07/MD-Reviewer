import { app, BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const root = isDev ? path.join(__dirname, '..') : path.join(process.resourcesPath, 'app');

let server = null;

function waitForServer(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
        } else {
          retry();
        }
      });
      req.on('error', retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - start > timeout) {
        reject(new Error('Server timeout'));
      } else {
        setTimeout(check, 250);
      }
    };
    check();
  });
}

function startServer() {
  if (isDev) {
    server = spawn('node', ['scripts/start.js'], {
      cwd: root,
      stdio: 'inherit',
      shell: true
    });
  } else {
    server = spawn('node', ['scripts/start.js'], {
      cwd: root,
      stdio: 'inherit'
    });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    title: 'MD Reader',
    autoHideMenuBar: true,
    backgroundColor: '#0f1116',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  waitForServer('http://127.0.0.1:3000')
    .then(() => win.loadURL('http://127.0.0.1:3000'))
    .catch(() => win.loadURL('http://127.0.0.1:3000'));
}

app.whenReady().then(() => {
  startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (server) {
    try { server.kill(); } catch {}
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (server) {
    try { server.kill(); } catch {}
  }
});
