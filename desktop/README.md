# MD Reader Desktop (Tauri)

The desktop wrapper runs the same local Express server used by the web app and loads the built UI in a Tauri window. It keeps the same security rules:

- Binds to `127.0.0.1` only
- All paths are sandboxed to the opened folder (no `..`, absolute paths, or symlink escapes)
- Only `.md` files are read/written via the file API
- Preview is sanitized (no script execution)
- Writes are atomic

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ (tested with Node 24)
- [Rust](https://www.rust-lang.org/tools/install) (stable) — required to build the Tauri app
- Platform build tools:
  - Windows: Microsoft C++ Build Tools
  - macOS: Xcode Command Line Tools
  - Linux: `build-essential`, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`

## Development

```bash
npm install
cd desktop
npm run tauri dev
```

## Build

```bash
npm install
cd desktop
npm run tauri build
```

The built installers/binaries will be in `desktop/src-tauri/target/release/bundle/`.

## Notes

- The desktop app uses native folder/file pickers via Tauri plugins.
- Rust toolchain is **not installed** in this environment; the Tauri project is provided for building on a machine with Rust available. The web app (`npm start`) works fully without Rust.
- Icons are placeholders; replace them in `desktop/src-tauri/icons/` for a polished release.
