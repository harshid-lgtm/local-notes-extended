# Changelog

All notable changes to **Local Notes Extended**. Versions before 1.4.0 were the original Local Notes build; 1.4.0 introduced the separate Extended product identity.

## 1.5.0 — 26 November 2026

### Added

- Non-Markdown files now appear in the vault sidebar.
- Read-only previews for PDF, Word `.docx`, text/CSV/JSON/HTML, images, audio and video.
- Other file types offer **Open default app**, **Download** and **Show in folder**.
- Desktop IPC to open a vault file in its default application.

### Note

Search, backlinks and the graph still index Markdown pages. Word `.doc` (legacy binary) and spreadsheet/presentation formats are opened with the system application rather than rendered in-app.

## 1.4.14 — 26 November 2026

### Fixed

- Share dialog headers now read **Share Local Notes Extended** and **Share Page name** without mojibake quotation marks.
- Corrected lingering UTF-8 text corruption in team-dialog strings.

## 1.4.13 — 26 November 2026

### Fixed

- The desktop app now opens on Home on launch, including when a team session is restored. The last open team page is no longer reopened on startup.
- Search is visible in the top bar at all widths.

### Improved sharing

- In **Share**, typing an email that is not on the server now offers **Invite … by email** directly instead of a dead end.
- The invitation creates a workspace link and opens the full email draft with the address prefilled.
- Existing server members still appear as selectable results and can be given page access immediately.

## 1.4.12 — 26 November 2026

### Added

- The team sign-in screen remembers previously used server addresses and offers them as suggestions.
- Email fields remember addresses used on this device and offer them while typing: sign-in, workspace invitations and sharing.
- Browser/OS email autofill remains enabled through the standard `autocomplete="email"` hint.

### Changed

- The desktop app now opens on **Home** instead of reopening the last page.
- The search button is always visible in the top bar, including on desktop and when the sidebar is collapsed.

### Note

Direct Gmail/Google Contacts access requires Google OAuth consent; the desktop app does not read a Google account’s contact list. The suggestions come from addresses used on this device and the team server directory.

## 1.4.11 — 25 November 2026

### Added

- Reopening the desktop app while a team workspace was active now restores that team connection automatically using the saved sign-in token.
- **Back to local notes** clears the remembered team session; **Sign out** does the same.
- The last team server is remembered alongside the persistent settings added in 1.4.10.

## 1.4.10 — 25 November 2026

### Fixed

- Desktop settings no longer live only in `localStorage` tied to the embedded server's random localhost port. Team server connections, saved sign-ins, theme, layout and other preferences are stored in `settings.json` under the app's user-data folder.
- Updating the app now keeps connection settings; they are no longer reset by a new random localhost origin.
- Values written by older builds are migrated from `localStorage` when first read.

### Note

If a pre-1.4.10 update already cleared a saved team connection, sign in to that server once. The connection is then stored in the persistent file and survives later updates.

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
