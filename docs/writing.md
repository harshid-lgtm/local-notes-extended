# Writing

Local Notes Extended hides markdown syntax while you write and saves clean markdown underneath.

## The slash menu

Type `/` on any line to insert a block:

| Block | Markdown it saves |
| --- | --- |
| Text, Heading 1–3 | `#`, `##`, `###` |
| Bulleted, numbered and to-do lists | `-`, `1.`, `- [ ]` |
| Quote and callout | `>` and `> [!note]` |
| Code block | ```` ``` ```` |
| Table, divider | GitHub tables, `---` |
| Link to page | `[[Page]]` |
| Template, Write with AI | — |

Keep typing after `/` to filter, then press `Enter`.

## Markdown shortcuts

Shortcuts work as you type: `# ` for a heading, `- ` for a bullet, `1. ` for a numbered list, `[] ` for a to-do, `> ` for a quote, ` ``` ` for code, `---` for a divider, and `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `==highlight==` inline.

## Formatting toolbar

Select text to see the toolbar: **Ask AI**, turn the block into another type, bold, italic, strikethrough, code, **Aa** text size, **A** text colour, highlight and link.

### Text size and colour

Select text, then choose a size or colour from the floating toolbar.

- **Aa** offers Small, Normal, Large and Huge.
- **A** offers Default, Ink, Brick, Forest, Ocean, Violet and Amber.
- **Normal** removes only the size; **Default** removes only the colour.

The formatting is saved as a Markdown span with inline CSS:

```html
<span style="font-size:1.3em;color:#2563a8">large blue text</span>
```

The page-wide **Default / Serif / Mono** choice in the page menu is separate from these per-selection styles.

## Links

There are three ways to create a link:

1. **Type or paste a bare URL** — for example `https://youtu.be/AZgzmX24-HY`. It becomes a link automatically.
2. **Select text and use Link** — enter a URL or an existing page name in the dialog. The dialog also edits or removes an existing link.
3. **Write Markdown directly** — `[label](https://example.com)`.

URLs inside code blocks stay as plain text. Saved bare URLs use Markdown autolink form: `<https://example.com>`.

## Moving blocks

Hover a block to see `+` and `⠿` to its left. Click `+` to add a block below; drag `⠿` to move the block.

## Callouts

Callouts use Obsidian's syntax and render as colored boxes:

```markdown
> [!tip] Title
> Body text
```

Types include `note`, `tip`, `info`, `success`, `warning`, `danger`, `example` and `quote`.

## Images

Images in your vault display inline — both `![alt](images/photo.png)` and Obsidian embeds like `![[photo.png]]`.

## Page style

Open the `•••` page menu to choose **Default**, **Serif** or **Mono** fonts, **Small text** or **Full width**. These are view preferences and do not change your files.
