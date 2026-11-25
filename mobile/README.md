# Local Notes on mobile

## Approach

Local Notes is already a browser-native editor: the UI is a bundled ES module and the
same page is served by the desktop app, the local vault server and the team server.
The mobile version therefore uses that existing web app as an **installable PWA**
instead of duplicating the editor in React Native or Flutter.

This keeps one implementation of the editor, Markdown round-tripping, search,
AI panels, export, permissions and the design system.

## Targets

| Platform | How it runs |
| --- | --- |
| Android 8+ | Chrome / Edge / Samsung Internet, installed to the home screen as a standalone app |
| iOS / iPadOS 16+ | Safari, **Share → Add to Home Screen**; standalone display |
| Desktop browsers | The existing browser mode at `npm start` (unchanged) |
| Windows / macOS / Linux | The existing Electron app (unchanged) |

The PWA manifest and service worker live in `public/` and are served by both the
local server and the team server.

## What is shared

- `src/` — the TipTap editor, command palette, search UI, team UI and AI panels.
- `public/` — the built bundle, icons, manifest and service worker.
- `shared/search-index.cjs` — ranked, typo-tolerant full-text search.
- `server/export.js` — DOCX, PDF, TXT, HTML and Markdown export.
- `server/ai.js` — the provider layer used by both desktop and team deployments.
- `team-server/` — accounts, workspaces, permissions, sync and AI.

## Mobile storage and offline behaviour

A browser tab cannot open an arbitrary folder on iOS or Android. On mobile the
vault is therefore a **team server workspace** (including the private space),
while the desktop and browser-on-desktop keep the local-folder vault.

- The app shell (`/`, JS, CSS, icons) is cached by `public/sw.js`.
- The last 80 pages opened on the device are cached in local storage.
- Search falls back to those cached pages when the server is unreachable, so
  recently read notes remain searchable offline.
- API responses are never cached by the service worker, because they can contain
  private team pages.
- Writes and live co-editing resume when the connection returns.

This is a deliberate trade-off: a store-ready native shell with direct
filesystem access would need a native storage adapter (Capacitor or a custom
iOS/Android project). The PWA path ships now and reuses the existing app without
forking the editor.

## Install

1. Deploy the team server with HTTPS (see [`team-server/README.md`](../team-server/README.md)).
2. Open the server URL on the phone.
3. Android: use the browser's **Install app** action. iOS: **Share → Add to Home Screen**.
4. Sign in, then open a workspace. Recent pages are cached automatically.

The desktop app can still connect to the same server from **vault menu → Connect
to a team server**.

## AI on mobile

AI is configured once by the server admin under **AI settings** and is used by
the mobile and desktop clients through the same `/api/ai/*` endpoints. Offline,
the panel reports that the server cannot be reached and notes remain available.
Local desktop users can keep using their own provider key without a team server.
