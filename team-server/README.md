# Local Notes team server

Self-hosted server for Local Notes teams: accounts, shared workspaces, a private space for every person, live co-editing, version history, comments with @mentions, an inbox, and an optional AI assistant the admin configures once for everyone. Your team uses it from the desktop app, or from any browser at your server's address.

Everything lives in one data folder: a SQLite database plus a **markdown mirror** of every page (`/data/vault`), laid out exactly like a Local Notes / Obsidian vault.

## Deploy with Docker (recommended)

You need a small Linux server (1 GB RAM is plenty for a team) with Docker, and a domain name.

1. Point a DNS record such as `notes.yourcompany.com` at the server.
2. Copy the files in [`deploy/`](deploy) to the server, then:

   ```bash
   cp .env.example .env    # set DOMAIN, TEAM_NAME
   docker compose up -d
   ```

3. Open `https://notes.yourcompany.com`. The first person to sign up becomes the admin and gets a shared workspace named after `TEAM_NAME`.
4. Click **Share** on a workspace to create invite links for teammates.

Caddy fetches and renews the HTTPS certificate automatically.

### Updating

```bash
docker compose pull && docker compose up -d
```

### Backups

Back up the `notes-data` volume (`/data` in the container). It holds `team.db` and the `vault/` markdown mirror. For a consistent copy of the database while running:

```bash
docker compose exec notes node -e "new (require('node:sqlite').DatabaseSync)('/data/team.db').exec(\"VACUUM INTO '/data/backup.db'\")"
```

## Run without Docker

Requires Node 22.13 or newer (uses the built-in `node:sqlite`).

```bash
npm install && npm run build          # in the repository root: builds the web app into public/
cd team-server && npm install
TEAM_NAME="Acme" npm start            # http://localhost:3000
```

Put it behind any HTTPS reverse proxy (Caddy, nginx, Traefik) that supports WebSockets.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3000` | HTTP + WebSocket port |
| `DATA_DIR` | `./data` | Database and markdown mirror |
| `TEAM_NAME` | `Team` | Shown on the sign-in page; name of the first workspace |
| `SIGNUP` | `invite` | `invite`: only the first user signs up freely, others need an invite link. `open`: anyone can sign up |
| `MIRROR` | `true` | Write every page to `DATA_DIR/vault` as markdown |
| `AI_RATE_LIMIT` | `60` | AI requests per person per 10 minutes |

## AI

Sign in as the admin (the first account) and open **AI settings (admin)** from your account menu. Pick Claude, OpenAI, Gemini, an OpenAI-compatible API, or an Ollama server, add the key and choose a model. Members can then use AI without keys of their own. The key is stored in the server database and never sent to browsers. See the [AI docs](../docs/ai.md).

## How it works

- **Live editing:** pages are [Yjs](https://yjs.dev) documents synced over WebSocket ([Hocuspocus](https://tiptap.dev/hocuspocus)). Edits merge without conflicts, and changes made during a dropped connection sync when it comes back.
- **Markdown:** editors send the page's markdown alongside, which powers search, backlinks, the graph, version history and the mirror.
- **Permissions:** each workspace has owners, admins, editors and viewers. Admins can add members and grant/revoke admin rights; only owners can change ownership. Private spaces have one member and can't be shared. Viewers connect read-only.
- **Security:** passwords are hashed with scrypt; sessions are random bearer tokens stored hashed; sign-in is rate-limited. Always run behind HTTPS.
