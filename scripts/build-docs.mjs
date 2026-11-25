// Renders docs/*.md into site/docs/*.html so GitHub and the website share one source.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import MarkdownIt from 'markdown-it';

const NAV = [
  ['Start here', [['README', 'Overview'], ['getting-started', 'Getting started'], ['writing', 'Writing'], ['organizing', 'Organizing']]],
  ['Go further', [['linking', 'Links, backlinks & graph'], ['templates', 'Templates & daily notes'], ['ai', 'AI assistant'], ['obsidian', 'Obsidian compatibility'], ['shortcuts', 'Keyboard shortcuts']]],
  ['Teams', [['teams', 'Working with your team'], ['self-hosting', 'Self-hosting the server']]],
  ['Help', [['faq', 'FAQ & troubleshooting']]],
];
const ORDER = NAV.flatMap(([, items]) => items);
const out = (slug) => (slug === 'README' ? 'index' : slug);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
// docs link to each other as foo.md on GitHub; the site serves foo.html
const linkOpen = md.renderer.rules.link_open || ((t, i, o, e, self) => self.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
  const href = tokens[idx].attrGet('href') || '';
  const m = href.match(/^([\w-]+)\.md(#.*)?$/);
  if (m) tokens[idx].attrSet('href', `${out(m[1])}.html${m[2] || ''}`);
  else if (/^https?:/.test(href)) { tokens[idx].attrSet('target', '_blank'); tokens[idx].attrSet('rel', 'noopener'); }
  return linkOpen(tokens, idx, opts, env, self);
};
md.renderer.rules.heading_open = (tokens, idx, opts, env, self) => {
  const t = tokens[idx];
  if (t.tag === 'h2' || t.tag === 'h3') t.attrSet('id', slugify(tokens[idx + 1].content));
  return self.renderToken(tokens, idx, opts);
};

const ICON = { tip: '💡', note: 'ℹ️', info: 'ℹ️', warning: '⚠️', danger: '⛔', success: '✅' };
function callouts(html) {
  return html.replace(/<blockquote>\s*<p>\[!(\w+)\]\s*([^\n<]*)(?:\n|<br>)?([\s\S]*?)<\/blockquote>/g, (_, type, title, rest) => {
    const t = type.toLowerCase();
    return `<div class="callout callout-${t}"><div class="callout-title"><span>${ICON[t] || 'ℹ️'}</span>${title || t[0].toUpperCase() + t.slice(1)}</div><div class="callout-body"><p>${rest}</div></div>`;
  });
}

const css = readFileSync(new URL('./docs.css', import.meta.url), 'utf8');
mkdirSync('site/docs', { recursive: true });
writeFileSync('site/docs/docs.css', css);

const files = readdirSync('docs').filter((f) => f.endsWith('.md'));
for (const f of files) {
  const slug = f.replace(/\.md$/, '');
  const src = readFileSync(`docs/${f}`, 'utf8');
  const title = (src.match(/^# (.+)$/m) || [, slug])[1];
  let body = callouts(md.render(src.replace(/^# .+\n/, '')));
  const toc = [...body.matchAll(/<h2 id="([^"]+)">(.*?)<\/h2>/g)].map(([, id, text]) => `<a href="#${id}">${text}</a>`).join('');
  const i = ORDER.findIndex(([s]) => s === slug);
  const prev = ORDER[i - 1];
  const next = ORDER[i + 1];
  const nav = NAV.map(([group, items]) => `<div class="nav-group"><div class="nav-label">${group}</div>${items.map(([s, label]) => `<a href="${out(s)}.html" class="${s === slug ? 'on' : ''}">${label}</a>`).join('')}</div>`).join('');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Local Notes docs</title>
<meta name="description" content="Local Notes documentation: ${esc(title)}">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="docs.css">
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="../index.html"><img src="../img/icon.png" alt="">Local Notes<span class="tag">Docs</span></a>
  <button class="menu-btn" aria-label="Menu" onclick="document.body.classList.toggle('nav-open')">☰</button>
  <nav class="links"><a href="../index.html#features">Features</a><a href="../index.html#download">Download</a><a href="https://github.com/harshid-lgtm/local-notes">GitHub</a></nav>
</div></header>
<div class="layout wrap">
  <aside class="side">${nav}</aside>
  <main class="doc">
    <div class="crumb">Docs${slug === 'README' ? '' : ` / ${esc(title)}`}</div>
    <h1>${esc(title)}</h1>
    ${body}
    <div class="pager">${prev ? `<a class="prev" href="${out(prev[0])}.html"><span>Previous</span>${prev[1]}</a>` : '<span></span>'}${next ? `<a class="next" href="${out(next[0])}.html"><span>Next</span>${next[1]}</a>` : ''}</div>
    <div class="edit"><a href="https://github.com/harshid-lgtm/local-notes/edit/main/docs/${f}">Edit this page on GitHub</a></div>
  </main>
  <nav class="toc">${toc ? `<div class="nav-label">On this page</div>${toc}` : ''}</nav>
</div>
</body>
</html>
`;
  writeFileSync(`site/docs/${out(slug)}.html`, html);
}
console.log(`docs: ${files.length} pages -> site/docs/`);
