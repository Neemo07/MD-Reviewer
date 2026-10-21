/**
 * Application bootstrap and wiring.
 */
import './styles.css';
import 'katex/dist/katex.min.css';
import { api } from './api.js';
import { state, setSettings } from './state.js';
import { createEditor } from './editor.js';
import { initPreview, renderMarkdown } from './preview.js';
import { dirOf } from './markdown.js';
import { applyTheme, storedTheme, nextTheme, onSystemThemeChange } from './theme.js';
import { createTree } from './tree.js';
import { toast, confirmDialog, promptDialog } from './modal.js';
import { createToolbar } from './toolbar.js';
import { createToc } from './toc.js';
import { createScrollSync } from './scrollsync.js';
import { applyFormat } from './formatting.js';
import { showContextMenu } from './contextmenu.js';
import { renderMermaidBlocks } from './mermaid.js';
import { buildStandaloneHtml, downloadText, printDocument } from './export.js';

const dom = {
  app: document.querySelector('.app'),
  workspace: document.getElementById('workspace'),
  sidebar: document.getElementById('sidebar'),
  rootName: document.getElementById('root-name'),
  docTitle: document.getElementById('doc-title'),
  tree: document.getElementById('file-tree'),
  editorHost: document.getElementById('editor'),
  preview: document.getElementById('preview'),
  previewPane: document.getElementById('preview-pane'),
  splitter: document.getElementById('splitter'),
  toolbar: document.getElementById('format-toolbar'),
  tocPanel: document.getElementById('toc-panel'),
  tocList: document.getElementById('toc-list'),
  statusFile: document.getElementById('status-file'),
  statusWords: document.getElementById('status-words'),
  statusChars: document.getElementById('status-chars'),
  statusCursor: document.getElementById('status-cursor'),
  statusSave: document.getElementById('status-save'),
  statusAutosave: document.getElementById('status-autosave'),
  saveBtn: document.getElementById('save-btn'),
  exportBtn: document.getElementById('export-btn'),
  themeBtn: document.getElementById('theme-btn'),
  toggleSidebar: document.getElementById('toggle-sidebar'),
  viewSwitch: document.getElementById('view-switch'),
  syncBtn: document.getElementById('sync-btn'),
  tocBtn: document.getElementById('toc-btn'),
  autosaveBtn: document.getElementById('autosave-btn'),
};

let editor = null;
let tree = null;
let toc = null;
let scrollSync = null;
let renderTimer = null;
let watcher = null;
let autosaveTimer = null;
/** Resolves when the last mermaid render finished (used by the export). */
let mermaidRender = Promise.resolve();

// ---------------------------------------------------------------- theme ---

function isDarkTheme() {
  return document.documentElement.dataset.resolvedTheme === 'dark';
}

function refreshEditorTheme() {
  editor?.setDark(isDarkTheme());
}

function setTheme(theme, { persist = true } = {}) {
  applyTheme(theme);
  setSettings({ theme });
  refreshEditorTheme();
  // The diagrams follow the theme of the app.
  if (state.file) renderPreview();
  if (persist) api.saveSettings({ theme }).catch(() => {});
}

// --------------------------------------------------------------- status ---

function updateSaveState() {
  const label = state.saving ? 'Saving…' : state.dirty ? 'Unsaved changes' : 'Saved';
  dom.statusSave.textContent = label;
  dom.statusSave.className = `status-item save-state ${state.saving ? 'saving' : state.dirty ? 'unsaved' : 'saved'}`;
  dom.saveBtn.textContent = state.dirty ? 'Save*' : 'Save';
  const name = state.file ? state.file.split('/').pop() : 'MD Reader';
  document.title = `${state.dirty ? '* ' : ''}${name} - MD Reader`;
  dom.docTitle.textContent = state.file ?? 'No file open';
}

function updateStatus(info) {
  dom.statusWords.textContent = `${info.words} words`;
  dom.statusChars.textContent = `${info.chars} characters`;
  dom.statusCursor.textContent = `Ln ${info.line}, Col ${info.column}`;
  dom.statusFile.textContent = state.file ?? 'No file';
}

// -------------------------------------------------------------- preview ---

function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPreview, 120);
}

function renderPreview() {
  if (renderTimer) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }
  const text = editor.getValue();
  const scrollTop = dom.previewPane.scrollTop;
  try {
    dom.preview.innerHTML = renderMarkdown(text);
  } catch (err) {
    console.error('[md-reader] render failed', err);
    dom.preview.textContent = 'The preview could not be rendered.';
    return;
  }
  dom.previewPane.scrollTop = scrollTop;
  toc?.update(dom.preview);
  scrollSync?.refresh();
  // Mermaid draws the diagrams itself, which happens asynchronously.
  mermaidRender = renderMermaidBlocks(dom.preview, { dark: isDarkTheme() })
    .catch((err) => console.error('[md-reader] mermaid failed', err));
  // The re-render moved the preview; keep the two panes in sync for a moment.
  scrollSync?.hold();
}

// ---------------------------------------------------------------- files ---

/** Folder in which new files are created: the folder of the open document. */
function currentDir() {
  return state.file ? dirOf(state.file) : '';
}

/** Name rules, mirrored from the server so the user gets instant feedback. */
function validateName(name, { extension } = {}) {
  const clean = (name ?? '').trim();
  if (!clean) return 'Please enter a name.';
  if (/[\\/:*?"<>|]/.test(clean)) return 'The name contains characters that are not allowed.';
  if (clean === '.' || clean === '..') return 'This name is not allowed.';
  if (clean.startsWith('.')) return 'The name must not start with a dot.';
  if (extension && !clean.toLowerCase().endsWith(extension)) return `The name must end with ${extension}.`;
  return null;
}

async function refreshTree() {
  try {
    const data = await api.getTree();
    tree.setData(data.tree);
  } catch (err) {
    toast(`Could not read the folder: ${err.message}`, 'error');
  }
}

async function openFile(path) {
  try {
    const file = await api.readFile(path);
    state.file = file.path;
    state.baseline = file.content;
    state.dirty = false;
    editor.setValue(file.content);
    editor.focus();
    dom.app.classList.add('has-file');
    tree.expandTo(file.path);
    tree.setActive(file.path);
    renderPreview();
    updateSaveState();
    editor.reportStatus();
    startWatching(file.path);
    api.saveSettings({ lastFile: file.path }).catch(() => {});
  } catch (err) {
    toast(`Could not open ${path}: ${err.message}`, 'error');
  }
}

function closeFile() {
  watcher?.close();
  watcher = null;
  state.file = null;
  state.baseline = '';
  state.dirty = false;
  editor.setValue('');
  dom.app.classList.remove('has-file');
  tree.setActive(null);
  renderPreview();
  updateSaveState();
  updateStatus({ words: 0, chars: 0, line: 1, column: 1 });
  api.saveSettings({ lastFile: null }).catch(() => {});
}

async function saveFile() {
  if (!state.file || state.saving) return;
  state.saving = true;
  updateSaveState();
  try {
    const content = editor.getValue();
    await api.saveFile(state.file, content);
    state.baseline = content;
    state.dirty = false;
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
  } finally {
    state.saving = false;
    updateSaveState();
  }
}

// ------------------------------------------------------- file management ---

async function newFile(dir = currentDir()) {
  const name = await promptDialog({
    title: 'New markdown file',
    message: dir ? `The file will be created in "${dir}".` : 'The file will be created in the root folder.',
    label: 'Name',
    value: 'untitled.md',
    confirmLabel: 'Create',
    validate: (value) => validateName(value, { extension: '.md' }),
  });
  if (!name) return;
  const path = dir ? `${dir}/${name}` : name;
  try {
    await api.createFile(path, '');
    await refreshTree();
    tree.expandTo(path);
    await openFile(path);
    toast(`Created ${name}`, 'ok');
  } catch (err) {
    toast(`Could not create ${name}: ${err.message}`, 'error');
  }
}

async function newFolder(dir = currentDir()) {
  const name = await promptDialog({
    title: 'New folder',
    message: dir ? `The folder will be created in "${dir}".` : 'The folder will be created in the root folder.',
    label: 'Name',
    value: 'new folder',
    confirmLabel: 'Create',
    validate: (value) => validateName(value),
  });
  if (!name) return;
  const path = dir ? `${dir}/${name}` : name;
  try {
    await api.createFolder(path);
    await refreshTree();
    tree.expandTo(path);
    toast(`Created folder ${name}`, 'ok');
  } catch (err) {
    toast(`Could not create ${name}: ${err.message}`, 'error');
  }
}

async function renameItem(path) {
  const node = tree.find(path);
  const isFolder = node?.type === 'dir';
  const oldName = path.split('/').pop();
  const name = await promptDialog({
    title: `Rename ${oldName}`,
    message: isFolder ? 'The folder keeps its content.' : 'Only .md files are allowed.',
    label: 'New name',
    value: oldName,
    confirmLabel: 'Rename',
    validate: (value) => validateName(value, { extension: isFolder ? null : '.md' }),
  });
  if (!name || name === oldName) return;
  const dir = dirOf(path);
  const to = dir ? `${dir}/${name}` : name;
  try {
    await api.rename(path, to);
    if (state.file === path) {
      // The open document was renamed: keep the editor content as it is.
      state.file = to;
      dom.statusFile.textContent = to;
      startWatching(to);
      api.saveSettings({ lastFile: to }).catch(() => {});
    }
    await refreshTree();
    tree.setActive(state.file);
    toast(`Renamed to ${name}`, 'ok');
  } catch (err) {
    toast(`Could not rename ${oldName}: ${err.message}`, 'error');
  }
}

async function deleteItem(path) {
  const node = tree.find(path);
  const isFolder = node?.type === 'dir';
  const name = path.split('/').pop();
  const confirmed = await confirmDialog({
    title: isFolder ? `Delete the folder "${name}"?` : `Delete "${name}"?`,
    message: isFolder
      ? 'The folder and everything inside it will be removed from disk. This cannot be undone.'
      : 'The file will be removed from disk. This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await api.remove(path);
    if (state.file === path || (state.file && state.file.startsWith(`${path}/`))) {
      closeFile();
    }
    await refreshTree();
    toast(`Deleted ${name}`, 'ok');
  } catch (err) {
    toast(`Could not delete ${name}: ${err.message}`, 'error');
  }
}

function openContextMenu(node, event) {
  const isFolder = node.type === 'dir';
  const items = [
    { label: 'Open', action: 'open', disabled: isFolder },
    { label: 'Rename…', action: 'rename' },
    { separator: true },
    { label: 'New file here…', action: 'new-file' },
    { label: 'New folder here…', action: 'new-folder' },
    { separator: true },
    { label: 'Delete', action: 'delete', danger: true },
  ];
  showContextMenu(event.clientX, event.clientY, items, (action) => {
    switch (action) {
      case 'open':
        openFile(node.path);
        break;
      case 'rename':
        renameItem(node.path);
        break;
      case 'new-file':
        newFile(node.path);
        break;
      case 'new-folder':
        newFolder(node.path);
        break;
      case 'delete':
        deleteItem(node.path);
        break;
      default:
        break;
    }
  });
}

// ------------------------------------------------------------- watching ---

function startWatching(path) {
  watcher?.close();
  watcher = api.watch(path, {
    changed: (data) => {
      if (!data || data.path !== state.file) return;
      const current = editor.getValue();
      if (data.content === current) return; // our own write
      if (!state.dirty) {
        // No local edits: reload silently.
        state.baseline = data.content;
        editor.setValue(data.content);
        renderPreview();
        updateSaveState();
      } else {
        // Local edits exist: ask the user what to do.
        showExternalChangeDialog(data.content);
      }
    },
    deleted: () => {
      toast(`The file ${path} was deleted on disk.`, 'error');
    },
  });
}

function showExternalChangeDialog(diskContent) {
  const dialog = document.createElement('div');
  dialog.className = 'modal-backdrop';
  dialog.innerHTML = `
    <div class="modal">
      <h2>File changed on disk</h2>
      <p>The file was modified by another program while you had unsaved changes.</p>
      <div class="modal-actions">
        <button type="button" class="btn" data-role="cancel">Cancel</button>
        <button type="button" class="btn" data-role="keep">Keep my version</button>
        <button type="button" class="btn danger" data-role="reload">Reload from disk</button>
      </div>
    </div>`;
  document.body.appendChild(dialog);
  const close = () => dialog.remove();
  dialog.querySelector('[data-role="cancel"]').addEventListener('click', close);
  dialog.querySelector('[data-role="keep"]').addEventListener('click', () => {
    close();
    toast('Keeping your version. Saving will overwrite the file on disk.');
  });
  dialog.querySelector('[data-role="reload"]').addEventListener('click', () => {
    close();
    state.baseline = diskContent;
    state.dirty = false;
    editor.setValue(diskContent);
    renderPreview();
    updateSaveState();
  });
}

// --------------------------------------------------------------- export ---

/** Write the current document as a standalone HTML file. */
async function exportHtml() {
  if (!state.file) {
    toast('Open a file before exporting.', 'error');
    return;
  }
  const name = state.file.split('/').pop();
  try {
    // Render once more, so that the export contains the current text.
    renderPreview();
    await mermaidRender;
    const html = await buildStandaloneHtml({
      title: name,
      preview: dom.preview,
      theme: isDarkTheme() ? 'dark' : 'light',
    });
    const fileName = `${name.replace(/\.md$/i, '')}.html`;
    downloadText(html, fileName);
    toast(`Exported ${fileName}`, 'ok');
  } catch (err) {
    toast(`Export failed: ${err.message}`, 'error');
  }
}

function openExportMenu() {
  const rect = dom.exportBtn.getBoundingClientRect();
  showContextMenu(rect.left, rect.bottom + 4, [
    { label: 'Export as HTML…', action: 'html' },
    { label: 'Print / save as PDF…', action: 'pdf' },
  ], (action) => {
    if (action === 'html') exportHtml();
    if (action === 'pdf') printDocument();
  });
}

// ------------------------------------------------------------ view mode ---

function setViewMode(mode) {
  dom.workspace.dataset.view = mode;
  for (const button of dom.viewSwitch.querySelectorAll('button')) {
    button.classList.toggle('active', button.dataset.view === mode);
  }
  setSettings({ viewMode: mode });
  api.saveSettings({ viewMode: mode }).catch(() => {});
}

function setSidebarOpen(open) {
  dom.app.classList.toggle('sidebar-hidden', !open);
  setSettings({ sidebarOpen: open });
  api.saveSettings({ sidebarOpen: open }).catch(() => {});
}

function setTocOpen(open) {
  setSettings({ tocOpen: open });
  api.saveSettings({ tocOpen: open }).catch(() => {});
  dom.tocPanel.hidden = !open;
  dom.tocBtn.classList.toggle('active', open);
  dom.tocBtn.setAttribute('aria-pressed', String(open));
}

function setSyncScroll(on) {
  setSettings({ syncScroll: on });
  api.saveSettings({ syncScroll: on }).catch(() => {});
  dom.syncBtn.classList.toggle('active', on);
  dom.syncBtn.setAttribute('aria-pressed', String(on));
}

function setAutosave(on) {
  setSettings({ autosave: on });
  api.saveSettings({ autosave: on }).catch(() => {});
  dom.autosaveBtn.classList.toggle('active', on);
  dom.autosaveBtn.setAttribute('aria-pressed', String(on));
  dom.statusAutosave.textContent = on ? 'Autosave on' : 'Autosave off';
  if (!on) clearTimeout(autosaveTimer);
}

/** Save automatically a moment after the last edit. */
function scheduleAutosave() {
  if (!state.settings.autosave || !state.dirty || !state.file) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    saveFile();
  }, 900);
}

// -------------------------------------------------------------- startup ---

async function init() {
  dom.editorHost.innerHTML = '';
  editor = createEditor({
    parent: dom.editorHost,
    onChange: (text) => {
      state.dirty = text !== state.baseline;
      updateSaveState();
      scheduleRender();
      scheduleAutosave();
    },
    onStatus: updateStatus,
    onSave: saveFile,
    onFormat: (action) => applyFormat(editor, action),
  });

  initPreview({ getBaseDir: () => (state.file ? dirOf(state.file) : '') });

  createToolbar(dom.toolbar, {
    onAction: (action) => applyFormat(editor, action),
  });

  toc = createToc(dom.tocList, {
    onJump: (heading) => {
      editor.goToLine(heading.line);
      scrollSync?.goToLine(heading.line);
      toc.setActive(heading.id);
    },
  });

  scrollSync = createScrollSync({
    editor,
    getPreviewScroller: () => dom.previewPane,
    getEditorScroller: () => editor?.view?.scrollDOM ?? null,
    isEnabled: () => Boolean(state.settings.syncScroll),
    onPreviewScrolled: (line) => {
      const heading = toc.headings.filter((entry) => entry.line <= line).pop();
      toc.setActive(heading?.id ?? '');
    },
  });
  scrollSync.start();

  // Handle for debugging and for the automated UI checks.
  window.mdReader = { state, api, editor, toc, scrollSync, dom, exportHtml };

  tree = createTree(dom.tree, {
    onOpen: openFile,
    onContext: openContextMenu,
  });

  let info;
  try {
    info = await api.getState();
  } catch (err) {
    dom.tree.innerHTML = `<div class="tree-empty">Could not reach the local server: ${err.message}</div>`;
    return;
  }

  state.root = info.root;
  state.rootName = info.rootName;
  dom.rootName.textContent = info.rootName;
  dom.rootName.title = info.root;
  setSettings(info.settings);

  const theme = storedTheme() ?? info.settings.theme ?? 'system';
  setTheme(theme, { persist: storedTheme() === null });

  setViewMode(info.settings.viewMode ?? 'split');
  setSidebarOpen(info.settings.sidebarOpen !== false);
  setTocOpen(Boolean(info.settings.tocOpen));
  setSyncScroll(info.settings.syncScroll !== false);
  setAutosave(Boolean(info.settings.autosave));
  refreshEditorTheme();
  onSystemThemeChange(refreshEditorTheme);

  await refreshTree();

  const lastFile = info.settings.lastFile;
  if (lastFile) {
    tree.expandTo(lastFile);
    await openFile(lastFile);
  }
  updateSaveState();
  editor.reportStatus();
}

// --------------------------------------------------------------- events ---

dom.saveBtn.addEventListener('click', saveFile);

dom.themeBtn.addEventListener('click', () => {
  setTheme(nextTheme(state.settings.theme));
});

dom.toggleSidebar.addEventListener('click', () => {
  setSidebarOpen(dom.app.classList.contains('sidebar-hidden'));
});

dom.viewSwitch.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-view]');
  if (button) setViewMode(button.dataset.view);
});

dom.syncBtn.addEventListener('click', () => {
  setSyncScroll(!state.settings.syncScroll);
});

dom.tocBtn.addEventListener('click', () => {
  setTocOpen(!state.settings.tocOpen);
});

dom.autosaveBtn.addEventListener('click', () => {
  setAutosave(!state.settings.autosave);
});

dom.exportBtn.addEventListener('click', openExportMenu);

document.getElementById('new-file').addEventListener('click', () => newFile());
document.getElementById('new-folder').addEventListener('click', () => newFolder());
document.getElementById('refresh-tree').addEventListener('click', refreshTree);

dom.preview.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#md:"]');
  if (link) {
    event.preventDefault();
    const target = link.getAttribute('href').slice(4);
    openFile(target);
    return;
  }
  // Clicking a heading moves the cursor in the editor as well.
  const heading = event.target.closest('h1, h2, h3, h4, h5, h6');
  if (heading?.id) {
    const line = Number(heading.dataset.line);
    if (line) editor.goToLine(line);
  }
});

// View mode shortcuts: Ctrl/Cmd+Alt+1 (editor), +2 (split), +3 (preview).
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || !event.altKey) return;
  const modes = { 1: 'editor', 2: 'split', 3: 'preview' };
  const mode = modes[event.key];
  if (!mode) return;
  event.preventDefault();
  setViewMode(mode);
});

window.addEventListener('beforeunload', (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

// Splitter drag -----------------------------------------------------------
{
  let dragging = false;
  dom.splitter.addEventListener('pointerdown', (event) => {
    dragging = true;
    dom.splitter.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  dom.splitter.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const rect = dom.workspace.getBoundingClientRect();
    const percent = ((event.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.min(85, Math.max(15, percent));
    dom.workspace.style.setProperty('--editor-flex', `${clamped}%`);
  });
  const stop = (event) => {
    if (!dragging) return;
    dragging = false;
    try { dom.splitter.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
  };
  dom.splitter.addEventListener('pointerup', stop);
  dom.splitter.addEventListener('pointercancel', stop);
}

init();
