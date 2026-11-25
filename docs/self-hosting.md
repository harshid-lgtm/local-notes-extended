# Self-hosting the team server

The team server is a small Node.js app that stores everything in one folder: a SQLite database and a **markdown mirror** of every page, laid out like a Local Notes / Obsidian vault.

## With Docker (recommended)

You need a small Linux server (1 GB RAM is plenty) with Docker, and a domain name.

1. Point a DNS record such as `notes.yourcompany.com` at the server.
2. Download the deploy kit: [`docker-compose.yml`](https://github.com/harshid-lgtm/local-notes/blob/main/team-server/deploy/docker-compose.yml), [`Caddyfile`](https://github.com/harshid-lgtm/local-notes/blob/main/team-server/deploy/Caddyfile) and [`.env.example`](https://github.com/harshid-lgtm/local-notes/blob/main/team-server/deploy/.env.example).
3. Configure and start:

   ```bash
   cp .env.example .env    # set DOMAIN and TEAM_NAME
   docker compose up -d
   ```

4. Open `https://notes.yourcompany.com` and create the admin account.

[Caddy](https://caddyserver.com) gets and renews the HTTPS certificate automatically.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `DOMAIN` | — | Address people use (Docker kit only) |
| `TEAM_NAME` | `Team` | Shown on sign-in; name of the first workspace |
| `SIGNUP` | `invite` | `invite`: only the first person signs up freely. `open`: anyone can |
| `MIRROR` | `true` | Write every page to `/data/vault` as markdown |
| `AI_RATE_LIMIT` | `60` | AI requests per person per 10 minutes |
| `PORT` / `DATA_DIR` | `3000` / `/data` | Without Docker: port and data folder |

## Updating

```bash
docker compose pull && docker compose up -d
```

## Backups

Back up the `notes-data` volume. For a consistent database copy while running:

```bash
docker compose exec notes node -e "new (require('node:sqlite').DatabaseSync)('/data/team.db').exec(\"VACUUM INTO '/data/backup.db'\")"
```

## Without Docker

Requires Node.js 22.13 or newer.

```bash
npm install && npm run build      # in the repository root
cd team-server && npm install
TEAM_NAME="Acme" npm start        # http://localhost:3000
```

Put it behind any HTTPS reverse proxy that supports WebSockets.

## Security notes

- Always run behind HTTPS.
- Passwords are hashed with scrypt; sessions are random tokens stored hashed; sign-in is rate-limited.
- Private spaces are enforced on the server — no other account can read them, including admins through the app.
- The AI key set by the admin is stored in the server database and never sent to browsers.
