# Changelog

All notable changes to **Local Notes Extended**. Versions before 1.4.0 were the original Local Notes build; 1.4.0 introduced the separate Extended product identity.

## 1.4.9 — 25 November 2026

### Added

- **Copy invitation** copies the whole invitation message instead of only the URL.
- **Email invite** opens the default email app with a complete subject, salutation, workspace name, inviter, role, join link and expiry.
- The invitation can be edited before opening the email app.

### Note

Local Notes Extended has no mail server and does not send email by itself. The email action prepares the message in the user's own mail app; the sender still presses Send. Automatic server-sent invitations would require SMTP credentials to be configured.

## 1.4.8 — 25 November 2026

### Changed

- New app icon: forest-green tile, two stacked pages and a coral **E** badge.
- The same mark is used for the desktop shortcut, window/taskbar icon, installer, website and PWA icons.
- The original Local Notes app keeps its own charcoal page icon.

## 1.4.7 — 25 November 2026

### Added

- Bare `http://` and `https://` URLs are linked automatically when a note opens, when you type them, and when you paste them.
- URLs inside code blocks stay plain text.

### Fixed

- Editing a note no longer rewrites a bare URL as plain text; it is saved as a Markdown autolink (`<https://example.com>`).

## 1.4.6 — 25 November 2026

### Fixed

- The **Link** button now opens an Add/Edit link dialog in the local editor instead of an inline field that was immediately hidden by the editor-blur handler.
- Team pages now use the same link dialog instead of `window.prompt()`, which Electron does not support.
- Links can be edited or removed from the dialog.

## 1.4.5 — 25 November 2026

### Fixed

- Closing the window, pressing Alt+F4 or quitting now waits for the pending autosave and title rename before the window is destroyed.
- The Electron main process waits for the renderer confirmation, with a six-second fallback for an unresponsive window.
- Verified by editing a note, immediately closing the Electron window, and checking the saved `.md` file.

## 1.4.4 — 25 November 2026

### Added

- Per-selection text size: **Small**, **Normal**, **Large** and **Huge**, from the **Aa** button in the floating toolbar.
- Per-selection text colour from the **A** button: Default, Ink, Brick, Forest, Ocean, Violet and Amber.
- Sizes and colours are stored as inline CSS in a Markdown span, for example:

  ```html
  <span style="font-size:1.3em;color:#2563a8">selected text</span>
  ```

- Removing a size keeps the colour, and removing a colour keeps the size.

## 1.4.2 — 25 November 2026

### Fixed

- Packaged Electron app failed at launch with a `pdfkit` ESM/CommonJS `ERR_REQUIRE_ESM` error. Pinned `pdfkit` to the CommonJS-compatible `0.17.0`.

## 1.4.1 — 25 November 2026

### Changed

- Installer, product name and application ID separated from the original Local Notes:
  - Product: **Local Notes Extended**
  - App ID: `io.github.harshidlgtm.localnotesextended`
  - Separate user-data folder and Windows application identity.
- Artifacts renamed to `Local-Notes-Extended-Setup-<version>-x64.exe`.

## 1.4.0 — 25 November 2026

### Added

- Extended edition with team workspaces, ranked search, member/admin roles, DOCX/PDF/TXT/HTML export, PWA support and configurable AI providers.
- Shared search index and export library used by local, team and mobile surfaces.
- Docker deployment for the team server.

[Unreleased changes](https://github.com/harshid-lgtm/local-notes-extended/compare/v1.4.8...main)
