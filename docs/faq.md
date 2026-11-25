# FAQ & troubleshooting

### Where are my notes?

In the folder you chose as your vault. Every page is a `.md` file; subpages are folders. Copy, back up or sync that folder however you like.

### Is Local Notes free?

Yes. The app and the team server are free and open source (MIT).

### Does it work offline?

Yes — local vaults don't need the internet at all. Team pages need a connection to the team server; short drops are fine while the page is open.

### Windows or macOS says the app is from an unknown developer

Early builds aren't code-signed yet. Windows: **More info → Run anyway**. macOS: right-click the app → **Open**.

### My changes from Obsidian don't show up

Switch away from Local Notes and back — it checks for outside changes whenever the window gets focus. If a page is open with unsaved edits, those win.

### AI says "Add your API key"

Open **AI settings**, choose a provider, paste your key and press **Save**. See [AI assistant](ai.md).

### AI with Ollama can't connect

Make sure Ollama is running (`ollama serve`) and you've pulled a model (`ollama pull llama3.2`). The default address is `http://localhost:11434`.

### Is my data sent anywhere?

Local vaults: only when you use an AI feature, and then only to the provider you configured. Teams: pages are stored on your own team server.

### I found a bug

Please [open an issue](https://github.com/harshid-lgtm/local-notes/issues) with steps to reproduce.
