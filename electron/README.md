# MD Reader Electron App

Run MD Reader in its own app window (no browser address bar/tabs).

## Quick start (development)
```bash
# From repo root
npm install
npm run build

# From electron folder
cd electron
npm install
npm start
```

## Build an installer (.exe/.dmg/.AppImage)
```bash
cd electron
npm run dist
```
Installers will be in `electron/dist/`.
