# Obsidian compatibility

Local Notes is designed to share a vault with Obsidian. Open the same folder in both apps and keep using each.

## Files are left alone

- Opening a page never rewrites it — files are only written when you edit them.
- Saved files keep their formatting: frontmatter, Windows line endings, your `*italic*` or `_italic_` style, lists placed directly under a paragraph, Windows paths and other text that markdown tools often "escape".
- In our test suite every sample note survives a load-and-save **byte for byte**.

## Supported syntax

| Obsidian feature | In Local Notes |
| --- | --- |
| `[[Wikilinks]]`, aliases, `[[Page#Heading]]` | Clickable links, `[[` autocomplete |
| `![[image.png]]` embeds | Images display inline |
| `> [!callout]` | Colored callout boxes with icons |
| `#tags` | Highlighted tags |
| `==highlights==` | Highlighted text |
| Frontmatter / properties | Shown as properties under the title |
| Templates folder & daily notes settings | Read from `.obsidian/` |
| `.trash` folder | Deleted pages go there |
| Folder notes (`Page.md` + `Page/`) | Shown as a page with subpages |

## Not supported yet

- Renaming a page doesn't update links to it in other pages (Obsidian does this).
- Raw HTML, math (`$…$`), Dataview queries and Canvas files are kept in your files but shown as plain text, or not shown.
