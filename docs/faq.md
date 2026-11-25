# FAQ & troubleshooting

### Where are my notes?

In the folder you chose as your vault. Every page is a `.md` file; subpages are folders. Copy, back up or sync that folder however you like.

### Is Local Notes Extended free?

Yes. The app and the team server are free and open source (MIT).

### Does it work offline?

Yes — local vaults do not need the internet at all. Team pages need a connection to the team server; short drops are fine while the page is open.

### I closed the app and lost my work

Install version **1.4.5 or later**. It waits for the pending autosave and title rename before closing the window. A hard kill from Task Manager or a system crash can still lose the last moment of typing.

### I have to enter my team server again after updating

Install version **1.4.10 or later**. Older builds kept team connections in browser `localStorage` tied to a random localhost port, so they were lost on restart or update. 1.4.10 stores them in `settings.json` in the app's user-data folder.

If an earlier update already removed the connection, sign in once; future updates keep it. From 1.4.11 onward, the app also reopens the last team workspace automatically. Use **Back to local notes** or **Sign out** first if you want the next launch to open your local vault.

### The app keeps asking to update

The update is ready but has not been installed yet. Choose **Restart to update** in the toast. If the update prompt never appears, install the latest `Local-Notes-Extended-Setup-<version>-x64.exe` from [Releases](https://github.com/harshid-lgtm/local-notes-extended/releases/latest).

### A link or bare URL does not work

- Version **1.4.7 or later** links bare `http://` and `https://` URLs automatically when a note opens, or when you type or paste them.
- Version **1.4.6 or later** has a working **Link** dialog for adding, editing and removing links.
- URLs inside code blocks intentionally stay plain text.

### The Local Notes Extended icon looks the same as Local Notes

Install version **1.4.8 or later**. The Extended icon is a forest-green tile with two stacked pages and a coral **E** badge. The original Local Notes icon is charcoal with one page and an orange dot.

If Windows still shows the old shortcut icon, reinstall the latest version or refresh the Windows icon cache.

### Windows or macOS says the app is from an unknown developer

Early builds are not code-signed yet. Windows: **More info → Run anyway**. macOS: right-click the app → **Open**.

### My changes from Obsidian do not show up

Switch away from Local Notes Extended and back — it checks for outside changes whenever the window gets focus. If a page is open with unsaved edits, those win.

### AI says “Add your API key”

Open **AI settings**, choose a provider, paste your key and press **Save**. See [AI assistant](ai.md).

### AI with Ollama cannot connect

Make sure Ollama is running (`ollama serve`) and you have pulled a model (`ollama pull llama3.2`). The default address is `http://localhost:11434`.

### Is my data sent anywhere?

Local vaults: only when you use an AI feature, and then only to the provider you configured. Teams: pages are stored on your own team server.

### I found a bug

Please [open an issue](https://github.com/harshid-lgtm/local-notes-extended/issues) with steps to reproduce.
