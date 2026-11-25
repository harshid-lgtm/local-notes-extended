# Getting started

## Install

Download the installer for your computer from the [website](https://harshid-lgtm.github.io/local-notes-extended/#download) or the [latest release](https://github.com/harshid-lgtm/local-notes-extended/releases/latest).

| Platform | File | Notes |
| --- | --- | --- |
| Windows 10/11 | `Local-Notes-Extended-Setup-<version>-x64.exe` | Use `-arm64.exe` on ARM devices |
| macOS 11+ | `Local-Notes-Extended-<version>-mac.dmg` | Works on Apple Silicon and Intel |
| Linux | `Local-Notes-Extended-<version>-x86_64.AppImage` or `.deb` | AppImage runs on any distribution |

> [!warning] First launch on an unsigned build
> Early releases are not code-signed yet. On **Windows**, choose **More info → Run anyway**. On **macOS**, right-click Local Notes Extended in Applications and choose **Open**, then **Open** again.

Local Notes Extended is a separate app from the original Local Notes. Both can be installed side by side.

It updates itself: when a new version is ready you’ll see **Restart to update**. Updates are checked on launch and every six hours.

## Open a vault

A vault is just a folder. On the welcome screen:

- **Open a folder** — pick any folder of markdown files, including an existing Obsidian vault.
- **Create a new vault** — makes a fresh folder with a welcome page.

Local Notes Extended remembers your recent vaults. Switch any time from the vault name at the top-left of the sidebar.

## A quick tour

- **Sidebar** — search, Ask AI, Home, Today's note, Graph view, and your pages. Drag the edge to resize it; press `Ctrl \` (`⌘ \` on Mac) to hide it.
- **Page** — the title is the file name. Type below it; markdown is formatted as you write.
- **Top bar** — breadcrumbs, save status, favorite star and the `•••` page menu (fonts, width, copy, delete).
- **Home** — recent pages and quick actions.

Everything saves automatically to the `.md` file a moment after you stop typing. Closing the window waits for the pending save, so recent edits are not lost on a normal close.

## Run in a browser instead

Prefer not to install? From a copy of the source code:

```bash
npm install
npm run build
npm start
```

This opens Local Notes Extended at `http://localhost:4321`.
