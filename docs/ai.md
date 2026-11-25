# AI assistant

Local Notes can rewrite, write, summarize and answer questions about your notes using the AI provider you choose. AI is **off until you set it up**, and nothing is sent anywhere until you use an AI feature.

## Set up a provider

Open **AI settings** — from the vault menu, `>ai settings` in search, or the first time you use an AI feature — and pick a provider:

| Provider | What you need | Cost |
| --- | --- | --- |
| **Claude** (Anthropic) | An API key from [console.anthropic.com](https://console.anthropic.com/settings/keys) | Pay per use to Anthropic |
| **OpenAI** | An API key from [platform.openai.com](https://platform.openai.com/api-keys) | Pay per use to OpenAI |
| **Gemini** (Google) | An API key from [Google AI Studio](https://aistudio.google.com/app/apikey) | Free tier, then pay per use |
| **Ollama** | [Ollama](https://ollama.com) installed, plus a model (`ollama pull llama3.2`) | Free — runs on your computer |
| **Custom API** | Any OpenAI-compatible endpoint: OpenRouter, LM Studio, Groq, vLLM… | Depends on the service |

Paste your key, press **Load available models**, pick one and press **Test**, then **Save**. For Claude, Local Notes defaults to Claude Opus 5.5; choose a smaller model such as Claude Haiku for lower cost.

## What you can do

**Edit a selection.** Select text and click **Ask AI** (or press `Ctrl J`):

- Improve writing, fix spelling & grammar, make shorter or longer, simplify
- Change tone, or translate into another language
- Summarize, explain, or find action items — inserted below the selection
- Or type any instruction, like "turn this into a table"

The result streams into a preview. Choose **Replace selection**, **Insert below**, **Copy** or **Try again**; `Esc` discards it.

**Write with AI.** Type `/ai` (or press `Ctrl J` with nothing selected) to continue writing, brainstorm, draft an outline, summarize the page or pull out action items — or describe what you want.

**Summarize a page.** The `•••` page menu has **Summarize with AI** and **Find action items with AI**.

**Ask your notes.** Click **Ask AI** in the sidebar and ask anything — "What did we decide about pricing?". Local Notes finds the most relevant pages, sends them with your question, and the answer cites them as links you can click. Sources are listed under each answer.

## Privacy & costs

- Requests go **directly from your computer to the provider** you chose. Local Notes has no servers in between.
- Only what a feature needs is sent: the selected text, the current page, or — for Ask your notes — your question plus the most relevant notes.
- Your API key is stored on your computer in the app's settings file and never shown again after saving.
- Providers bill you directly for usage. With **Ollama**, nothing leaves your machine and there's nothing to pay.

## AI for teams

On a team server, the **admin** chooses the provider and key once in **AI settings (admin)** from their account menu. Everyone else can use AI without a key of their own. Ask your notes only searches the workspaces a person belongs to, including their private space. Each person can make 60 AI requests per 10 minutes by default (`AI_RATE_LIMIT` on the server).
