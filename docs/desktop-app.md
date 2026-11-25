# Desktop app, updates and saving

Local Notes Extended is a separate desktop application from the original Local Notes. Both can be installed on the same computer; they use different names, application IDs and data folders.

## Install

Download the installer for your platform from the [latest release](https://github.com/harshid-lgtm/local-notes-extended/releases/latest).

| Platform | Installer |
| --- | --- |
| Windows 10/11 x64 | `Local-Notes-Extended-Setup-<version>-x64.exe` |
| Windows 10/11 ARM64 | `Local-Notes-Extended-Setup-<version>-arm64.exe` |
| macOS 11+ | `Local-Notes-Extended-<version>-mac.dmg` |
| Linux | `Local-Notes-Extended-<version>-x86_64.AppImage` or `.deb` |

The Windows installer updates Local Notes Extended in place. It does not touch the original Local Notes installation.

## Updates

The app checks for updates when it opens and again every six hours.

1. The update downloads in the background.
2. When it is ready, a toast appears: **Local Notes Extended X.Y.Z is ready**.
3. Choose **Restart to update**.

If the app was closed before updating, the downloaded update is checked again on the next launch.

The update feed is the [local-notes-extended repository](https://github.com/harshid-lgtm/local-notes-extended). The original Local Notes app uses its own repository and update feed.

## Saved sign-ins and preferences

From 1.4.10 onward, desktop settings are stored in `settings.json` in the app's user-data folder instead of browser `localStorage`. This covers:

- team server addresses and sign-in tokens,
- theme, font and layout preferences,
- recent panel state.

Updating the app preserves that file. If an earlier update already cleared a connection, sign in once; later updates keep it.

From 1.4.11 onward, reopening the app while you were in a team workspace takes you back to that team server automatically. Choosing **Back to local notes** or **Sign out** clears the remembered team session, so the next launch opens your local vault instead.

## Saving and closing

Every page is a normal `.md` file in your vault. Edits autosave about 650 ms after you stop typing.

From 1.4.5 onward, closing the window is safe:

- The window sends a close request to the editor.
- The editor finishes any pending note save and title rename.
- The window closes only after the save is confirmed.
- A six-second fallback closes an unresponsive window.

A hard kill from Task Manager or a system crash can still lose the last fraction of a second of typing.

## Why the icon is different

The Extended icon uses a forest-green tile, two stacked pages and a coral **E** badge. The original Local Notes icon is a charcoal tile with a single page and an orange dot.

If Windows still shows the old shortcut icon after installing 1.4.8 or later, reinstall the latest version or refresh the Windows icon cache. The app’s own window and taskbar icon comes from the packaged `public/icon-512.png`.

## Common problems

### “Restart to update” does not appear

Open the [latest release](https://github.com/harshid-lgtm/local-notes-extended/releases/latest) directly and install the newest `Local-Notes-Extended-Setup-<version>-x64.exe`. This also refreshes the shortcut icon.

### A link or URL stopped working

- Bare `http://` and `https://` URLs become links automatically from 1.4.7 onward.
- Select text and use **Link** to add, edit or remove a link from 1.4.6 onward.
- URLs inside code blocks intentionally stay as text.

### The app is still called Local Notes somewhere

Remove the old 1.4.x shortcut if it points at a pre-rename build, then install the latest Extended installer. Current builds use the product name **Local Notes Extended** and a separate app ID.
