# Templates & daily notes

## Templates

Any page in your vault's `Templates` folder is a template. (If you set a different folder in Obsidian's Templates settings, Local Notes uses that.)

- **New page from a template** — the `+` next to **Pages**, the Home screen, or `>` in search.
- **Insert into the current page** — type `/template`.

Don't have templates yet? The picker offers four starters: meeting notes, project brief, daily note and wiki page.

### Variables

| Variable | Becomes |
| --- | --- |
| `{{title}}` | The page title |
| `{{date}}` | Today, e.g. `2026-11-25` |
| `{{time}}` | The current time, e.g. `14:05` |
| `{{date:dddd, MMMM D}}` | Custom format, e.g. `Wednesday, November 25` |

Format tokens: `YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm ss A a`.

## Daily notes

Click **Today** in the sidebar to open today's note, creating it if needed. Local Notes follows Obsidian's Daily notes settings (folder, date format and template) when your vault has them; otherwise notes are named `YYYY-MM-DD` at the top of the vault.
