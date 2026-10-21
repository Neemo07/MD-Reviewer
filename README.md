# MD Reader

A local Markdown previewer and editor with a web-view GUI. It opens a folder of
`.md` files, lets you edit them with a live rendered preview, and saves the
changes back to disk.

Everything runs locally: the server binds to `127.0.0.1`, all assets are
bundled, and the app never makes a request to the network.

---

## Quick start

```bash
npm install
npm start                 # serves http://127.0.0.1:3000
npm start -- ./notes      # serves the ./notes folder instead
```

`npm start` builds the client (Vite) when the build is missing or out of date
and then starts the Express server. Use `npm start -- --rebuild` to force a
rebuild.

For development with hot reload:

```bash
npm run dev               # Vite on http://127.0.0.1:5173, API proxied to :3000
```

Run the automated tests:

```bash
npm test
```

---

## Usage

### Opening and editing

| Action | How |
| --- | --- |
| Open a file | Click it in the sidebar tree |
| Edit | Type in the left pane; the preview updates after ~120 ms |
| Save | `Ctrl`/`Cmd` + `S`, or the **Save** button |
| Switch view | The **Editor / Split / Preview** buttons, or `Ctrl`/`Cmd`+`Alt`+`1` / `2` / `3` |
| Toggle theme | The theme button (cycles system → light → dark) |
| Toggle sidebar | The sidebar button in the title bar |
| Toggle outline | The outline button in the title bar |
| Toggle scroll sync | The sync button in the title bar |
| Toggle autosave | The autosave button in the title bar |
| Find & replace | `Ctrl`/`Cmd` + `F` (CodeMirror search panel) |
| Undo / redo | `Ctrl`/`Cmd` + `Z` / `Ctrl`/`Cmd` + `Shift` + `Z` |

The status bar shows the word count, the character count, the cursor position,
the autosave state and the save state. The title bar and the status bar show an
**unsaved changes** indicator, and the browser asks before the tab is closed
with unsaved edits.

Relative links and images in the preview resolve against the folder of the
file that is open. Markdown links open the target file in the editor, images
are served through the local file API.

### Markdown features

| Feature | Notes |
| --- | --- |
| GitHub Flavoured Markdown | Tables, task lists, strikethrough, autolinks |
| Syntax highlighting | `highlight.js` (common languages), kept offline |
| Math (KaTeX) | Inline `$...$` and display `$$...$$` blocks. Invalid formulas render as a readable error. |
| Diagrams (Mermaid) | Use a fenced code block tagged ` ```mermaid `. Invalid diagrams show a readable error. The diagrams follow the app's light/dark theme. |
| Relative links & images | Resolved against the folder of the open file and opened safely inside the app or through `/api/raw` |

### Export

The **Export** button in the top bar opens a menu with:

| Action | Notes |
| --- | --- |
| Export as HTML… | Downloads a standalone HTML file with the styles, KaTeX fonts, images and diagrams inlined. The file can be opened offline. |
| Print / save as PDF… | Opens the browser's print dialog; the built-in print stylesheet hides the interface and prints only the preview. |

### File management

The sidebar has three small buttons: **new file**, **new folder** and
**refresh**. Right-clicking a file or a folder in the tree opens a context
menu with *Open*, *Rename…*, *New file here…*, *New folder here…* and
*Delete*.

* Names are validated before the request is sent: no path separators or
  reserved characters, no leading dot, and `.md` for files.
* Creating or renaming onto an existing name is refused by the server
  (`409 EXISTS`) — nothing is ever overwritten silently.
* Deleting always asks for confirmation and says what will happen.
* Folders are deleted with their content.

### Formatting toolbar

The row above the editor holds the ten formatting actions. Every button has a
keyboard shortcut:

| Action | Shortcut | Action | Shortcut |
| --- | --- | --- | --- |
| Bold | `Ctrl`/`Cmd`+`B` | Inline code | `Ctrl`/`Cmd`+`E` |
| Italic | `Ctrl`/`Cmd`+`I` | Code block | `Ctrl`/`Cmd`+`Shift`+`E` |
| Heading (cycles `H1`…`H6`, then plain) | `Ctrl`/`Cmd`+`Alt`+`H` | Bullet list | `Ctrl`/`Cmd`+`Shift`+`L` |
| Link | `Ctrl`/`Cmd`+`K` | Numbered list | `Ctrl`/`Cmd`+`Shift`+`N` |
| Quote | `Ctrl`/`Cmd`+`Alt`+`Q` | Table | `Ctrl`/`Cmd`+`Alt`+`T` |

Bold, italic, inline code and links wrap the selection (and unwrap it again
when it is already wrapped). Lists and quotes toggle the prefix on every
selected line, the heading action changes the level of the current line.

### Outline

The outline panel is a third column next to the preview. It lists the headings
of the open document; clicking an entry moves the cursor in the editor to that
heading and scrolls the preview to it. The entry of the heading you are
currently looking at is highlighted while scrolling.

### Synchronised scrolling

With scroll sync enabled (on by default) the editor and the preview follow
each other. The mapping is done by source line: every block in the preview
carries the line it came from, so both panes stay on the same paragraph even
though the two renderings have different heights. A short lock after each
programmatic scroll keeps the two panes from pushing each other back and
forth.

### Autosave

Autosave is **off** by default; the status bar always shows the current state
("Autosave on" / "Autosave off"). When it is on, the file is saved about a
second after the last edit.

### External changes

If the open file is changed by another program:

* the document is **clean** → the file is reloaded silently, no dialog;
* the document is **dirty** → a dialog asks whether to keep your version or
  to reload the file from disk. Keeping your version means that the next save
  overwrites the external change.

### Remembered settings

The theme, the view mode, the sidebar state, the outline state, scroll sync,
autosave, the last opened folder and the last opened file are remembered
between sessions (see *Settings* under [Decisions](#decisions)).

---

## Architecture

```
MD Reader/
├─ server/          Express app: static UI + the local file API
│  ├─ src/
│  │  ├─ index.js   CLI entry point (--root, --port)
│  │  ├─ app.js     Express app and routes
│  │  └─ lib/
│  │     ├─ paths.js    path sandbox: the only place paths are resolved
│  │     ├─ fsops.js    read / atomic write / create / rename / delete
│  │     ├─ settings.js persisted UI settings
│  │     └─ watcher.js  server sent events for external changes
│  └─ test/        API tests (node:test)
├─ client/          Vite app: vanilla JS + CodeMirror 6
│  ├─ index.html    application shell
│  └─ src/
│     ├─ main.js       wiring: state, events, rendering loop
│     ├─ editor.js     CodeMirror 6 setup + the formatting API
│     ├─ preview.js    markdown rendering + DOMPurify sanitising
│     ├─ markdown.js   markdown-it configuration
│     ├─ katex.js       KaTeX maths (inline + block)
│     ├─ mermaid.js    Mermaid diagrams (lazy, cached)
│     ├─ export.js     standalone HTML export and print/PDF
│     ├─ formatting.js formatting actions (bold, lists, table, …)
│     ├─ toolbar.js    formatting toolbar
│     ├─ toc.js        outline panel
│     ├─ scrollsync.js synchronised scrolling
│     ├─ contextmenu.js context menu for the file tree
│     ├─ tree.js       sidebar file tree
│     ├─ theme.js      light / dark / system
│     ├─ modal.js      confirm / prompt dialogs and toasts
│     ├─ state.js      tiny observable state
│     ├─ api.js        client for the local file API
│     ├─ html.js       shared HTML escaping
│     └─ styles.css    application and preview styles
├─ desktop/         Tauri desktop wrapper (phase 4)
└─ sample-notes/    a small folder to try the app with
```

### The file API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/state` | root folder + settings |
| `GET` | `/api/tree` | folder tree (markdown files only) |
| `GET` | `/api/file?path=` | read a file |
| `PUT` | `/api/file` | save a file (atomic) |
| `POST` | `/api/file` | create a file |
| `POST` | `/api/folder` | create a folder |
| `POST` | `/api/rename` | rename a file or folder |
| `DELETE` | `/api/file` | delete a file or folder |
| `GET` | `/api/raw?path=` | serve an image or asset for the preview |
| `GET` | `/api/watch?path=` | server sent events for external changes |
| `GET`/`PUT` | `/api/settings` | read / write UI settings |
| `POST` | `/api/root` | switch the exposed root folder |

### Security model

* The server listens on `127.0.0.1` only.
* Every path that reaches the filesystem goes through `server/src/lib/paths.js`:
  absolute paths, `..` segments, drive letters, UNC paths and symlinks that
  leave the root folder are rejected with `400`.
* Only `.md` files can be read or written through the file API. Images and
  other assets are served by `/api/raw`, which only allows a small list of
  inert content types and sends `Content-Security-Policy: sandbox`.
* Markdown is rendered with `html:false` **and** sanitised with DOMPurify, so
  no script from a markdown file can ever run.
* Writes are atomic: the content goes to a temporary file in the same folder,
  is flushed with `fsync`, and is then renamed over the target. A crash can
  never leave a half written file behind.
* Creating and renaming refuse to overwrite an existing file (`409 EXISTS`).

---

## Decisions

* **Root folder** — the CLI argument wins. Without one the app reopens the
  folder that was used last (remembered in `~/.mdreader/settings.json`), and
  falls back to the current directory on the very first run.
* **Settings** — stored in `~/.mdreader/settings.json`, never inside the notes
  folder, so that reading a folder never writes anything into it.
* **Task lists** — implemented directly instead of using a plugin: the
  markdown-it plugin injects raw HTML, which markdown-it escapes while
  `html:false` is enabled.
* **Highlighting** — `highlight.js` is imported from its "common" bundle
  (~40 languages) to keep the client bundle small.
* **PDF export** — the browser's own print-to-PDF keeps the app dependency
  free and works offline. The standalone HTML export is built in the browser
  and inlines assets so that the file stays usable without the server.
* **`allowDir` in `paths.js`** — the flag means "this route may also address
  folders", not "the target has to be a folder". Without it a path has to be a
  regular file.
* **Outline** — the entries are taken from the *rendered* preview instead of
  from the source, so the outline always matches what the reader sees. The
  heading ids are made unique per document (`intro`, `intro-1`, …).
* **Scroll sync** — the panes are mapped by source line, not by pixel ratio,
  and a 150 ms lock after every programmatic scroll prevents a feedback loop.
* **"Silent reload"** — when a clean document is changed on disk the file is
  reloaded without any dialog or notification.
* **Offline maths and diagrams** — KaTeX and Mermaid run entirely in the
  browser. The standalone HTML export inlines the fonts, styles, images and
  diagrams so that the file remains usable without the app or a network.

---

## Desktop build (phase 4)

See [desktop/README.md](desktop/README.md). The Tauri wrapper uses the same
local server and security rules as the web app, adds native folder/file
pickers, and can be built with `npm run tauri build` from the `desktop/`
directory.

**Note:** Rust is not installed in this environment, so the Tauri app cannot be
compiled/verified locally. The project files are provided so that it can be
built on a machine with the Rust toolchain installed. The web app continues
to work with `npm install && npm start`.
