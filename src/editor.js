// The WYSIWYG editor: TipTap + markdown round-tripping + Obsidian-flavoured extras
// (wikilinks, embeds, ==highlights==, #tags, > [!callouts]).
import { Editor, Extension, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Text from '@tiptap/extension-text';
import HardBreak from '@tiptap/extension-hard-break';
import Italic from '@tiptap/extension-italic';
import { MarkdownSerializerState } from 'prosemirror-markdown';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import BubbleMenu from '@tiptap/extension-bubble-menu';
import Suggestion from '@tiptap/suggestion';
import GlobalDragHandle from './vendor/drag-handle.js';
import { Markdown } from 'tiptap-markdown';
import markPlugin from 'markdown-it-mark';
import { Plugin, PluginKey, EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { createLowlight, common } from 'lowlight';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { Mark } from '@tiptap/core';
import { icon } from './icons.js';
import { esc, h } from './ui.js';

// The host app plugs in vault-aware behaviour here.
export const host = {
  resolveNote: () => null,      // (target) -> vault path | null
  resolveAsset: () => null,     // (target) -> url | null
  noteSuggestions: () => [],    // (query) -> [{name, path, folder}]
  openLink: () => {},           // (href | {wikilink})
};

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

// ------------------------------------------------------------------ text escaping
// prosemirror-markdown escapes every [ ] _ * ` and turns < into &lt;. That would
// rewrite callouts, Windows paths and footnotes in people's files, so escape only
// what would otherwise change meaning on the next parse.
function gentleEscape(str, startOfLine) {
  str = str
    .replace(/\\(?=[!-/:-@[-`{-~])/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\*/g, (m, i) => (/\s/.test(str[i - 1] ?? ' ') && /\s/.test(str[i + 1] ?? ' ') ? m : '\\*'))
    .replace(/_/g, (m, i) => (/\w/.test(str[i - 1] ?? '') && /\w/.test(str[i + 1] ?? '') ? m : /\s/.test(str[i - 1] ?? ' ') && /\s/.test(str[i + 1] ?? ' ') ? m : '\\_'))
    .replace(/~~/g, '\\~~')
    .replace(/==/g, '\\==')
    .replace(/\[\[/g, '\\[\\[')
    .replace(/\]\(/g, '\\](');
  if (startOfLine) {
    str = str.replace(/^(\+[ ]|[-*>] )/, '\\$&').replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3').replace(/^(\s*\d+)\.\s/, '$1\\. ');
  }
  return str;
}

const GentleText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const startOfLine = state.atBlank() || state.closed;
          state.text(gentleEscape(node.text, startOfLine), false);
        },
        parse: {},
      },
    };
  },
});

// Obsidian treats a single newline as a line break, so parse it that way (breaks: true)
// and write it back as a plain newline instead of CommonMark's "\" + newline.
const ObsidianHardBreak = HardBreak.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state, node, parent, index) {
          for (let i = index + 1; i < parent.childCount; i++) {
            if (parent.child(i).type !== node.type) { state.write('\n'); return; }
          }
        },
        parse: {},
      },
    };
  },
});

// tiptap-markdown only tracks tight/loose for bullet & ordered lists; to-do lists need it too
// or every checklist gains blank lines between items on save.
const TightTaskLists = Extension.create({
  name: 'tightTaskLists',
  addGlobalAttributes() {
    return [{
      types: ['taskList'],
      attributes: {
        tight: {
          default: true,
          parseHTML: (el) => el.getAttribute('data-tight') === 'true' || !el.querySelector('p'),
          renderHTML: (attrs) => ({ 'data-tight': attrs.tight ? 'true' : null }),
        },
      },
    }];
  },
});

// Per-note markdown style, sniffed from the file so we write it back the way it was written.
export const mdStyle = { em: '*' };
export function sniffStyle(markdown) {
  const underscores = (markdown.match(/(^|[^\w_])_[^_\s][^_\n]*?_(?![\w_])/g) || []).length;
  const stars = (markdown.match(/(^|[^*])\*[^*\s][^*\n]*?\*(?!\*)/g) || []).length;
  mdStyle.em = underscores > stars ? '_' : '*';
}

const StyledItalic = Italic.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: () => mdStyle.em, close: () => mdStyle.em, mixable: true, expelEnclosingWhitespace: true },
        parse: {},
      },
    };
  },
});

// Lists written directly under a paragraph ("Steps:\n- one") are common in Obsidian notes.
// Remember that at parse time and don't insert a blank line between them on save.
function attachedListsMarkdownIt(md) {
  if (md.__lnAttached) return;
  md.__lnAttached = true;
  md.core.ruler.push('ln_attached_lists', (state) => {
    const t = state.tokens;
    for (let i = 3; i < t.length; i++) {
      if (!/^(bullet|ordered)_list_open$/.test(t[i].type) || t[i - 1].type !== 'paragraph_close') continue;
      const open = t[i - 3];
      if (open?.type === 'paragraph_open' && !open.hidden && open.map && t[i].map && open.map[1] === t[i].map[0]) {
        t[i].attrSet('data-attached', '1');
      }
    }
  });
}

const AttachedLists = Extension.create({
  name: 'attachedLists',
  addGlobalAttributes() {
    return [{
      types: ['bulletList', 'orderedList', 'taskList'],
      attributes: {
        attached: {
          default: false,
          parseHTML: (el) => el.getAttribute('data-attached') === '1',
          renderHTML: (attrs) => (attrs.attached ? { 'data-attached': '1' } : {}),
        },
      },
    }];
  },
  addStorage() {
    return { markdown: { parse: { setup: attachedListsMarkdownIt } } };
  },
});

const renderList = MarkdownSerializerState.prototype.renderList;
MarkdownSerializerState.prototype.renderList = function (node, delim, firstDelim) {
  const prev = this.closed?.type.name;
  if (node.attrs.attached && prev === 'paragraph') this.flushClose(1);
  // a plain bullet inside a checklist becomes its own list in the editor; in markdown they're one list
  const pair = new Set([prev, node.type.name]);
  if (pair.size === 2 && pair.has('taskList') && pair.has('bulletList') && node.attrs.tight !== false) this.flushClose(1);
  return renderList.call(this, node, delim, firstDelim);
};

// ------------------------------------------------------------------ wikilinks
function splitTarget(raw) {
  const [target, ...alias] = raw.split('|');
  return { target: target.trim(), alias: alias.join('|').trim() || null };
}

function wikiMarkdownIt(md) {
  if (md.__localNotesWiki) return;
  md.__localNotesWiki = true;
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const { src, pos } = state;
    let start = pos;
    let embed = false;
    if (src.charCodeAt(pos) === 0x21 /* ! */ && src.startsWith('[[', pos + 1)) { embed = true; start = pos + 1; }
    else if (!src.startsWith('[[', pos)) return false;
    const end = src.indexOf(']]', start + 2);
    if (end < 0) return false;
    const inner = src.slice(start + 2, end);
    if (!inner.trim() || inner.includes('\n') || inner.includes('[[')) return false;
    if (!silent) {
      const t = state.push(embed ? 'wiki_embed' : 'wikilink', '', 0);
      t.content = inner.replace(/\\\|/g, '|');
    }
    state.pos = end + 2;
    return true;
  });
  md.renderer.rules.wikilink = (tokens, i) => `<span data-wikilink="${esc(tokens[i].content)}"></span>`;
  md.renderer.rules.wiki_embed = (tokens, i) => `<span data-wikiembed="${esc(tokens[i].content)}"></span>`;
}

const WikiLink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { target: { default: '' }, alias: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'span[data-wikilink]', getAttrs: (el) => splitTarget(el.getAttribute('data-wikilink')) }];
  },
  renderHTML({ node }) {
    const raw = node.attrs.target + (node.attrs.alias ? `|${node.attrs.alias}` : '');
    return ['span', { 'data-wikilink': raw, class: 'wikilink' }, node.attrs.alias || node.attrs.target];
  },
  renderText({ node }) {
    return node.attrs.alias || node.attrs.target;
  },
  addNodeView() {
    return ({ node }) => {
      const { target, alias } = node.attrs;
      const [page, heading] = target.split('#');
      const exists = !!host.resolveNote(page || target);
      const label = alias || (heading ? `${page || ''} › ${heading}` : target);
      const dom = h(`<span class="wikilink ${exists ? '' : 'unresolved'}" data-wikilink="${esc(target)}" title="${exists ? 'Open' : 'Create'} “${esc(page || target)}”">${icon('page-link', 15)}<span class="wl-text">${esc(label)}</span></span>`);
      return { dom };
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.write(`[[${node.attrs.target}${node.attrs.alias ? `|${node.attrs.alias}` : ''}]]`);
        },
        parse: { setup: wikiMarkdownIt },
      },
    };
  },
});

const WikiEmbed = Node.create({
  name: 'wikiEmbed',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { target: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-wikiembed]', getAttrs: (el) => ({ target: el.getAttribute('data-wikiembed') }) }];
  },
  renderHTML({ node }) {
    return ['span', { 'data-wikiembed': node.attrs.target }];
  },
  addNodeView() {
    return ({ node }) => {
      const [file, size] = node.attrs.target.split('|');
      if (IMAGE_RE.test(file)) {
        const url = host.resolveAsset(file);
        const width = /^\d+/.test(size || '') ? `style="width:${parseInt(size, 10)}px"` : '';
        const dom = url
          ? h(`<span class="embed-img"><img src="${esc(url)}" alt="${esc(file)}" ${width} loading="lazy"></span>`)
          : h(`<span class="embed-missing">${icon('image', 15)}<span>${esc(file)}</span><em>not found</em></span>`);
        return { dom };
      }
      const dom = h(`<span class="wikilink embed" data-wikilink="${esc(file)}">${icon('page-link', 15)}<span class="wl-text">${esc(file)}</span><span class="wl-badge">embed</span></span>`);
      return { dom };
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node) { state.write(`![[${node.attrs.target}]]`); },
        parse: {},
      },
    };
  },
});

// ------------------------------------------------------------------ marks & nodes with markdown tweaks
// Underline and coloured highlights have no markdown syntax, so they're stored as the small
// bits of HTML Obsidian understands: <u>text</u> and <mark style="background: #hex;">text</mark>
// (the format of Obsidian's Highlightr plugin). Plain yellow stays ==text==.
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;
function htmlMarksMarkdownIt(md) {
  if (md.__lnHtmlMarks) return;
  md.__lnHtmlMarks = true;
  md.inline.ruler.after('html_inline', 'ln_html_marks', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
    const m = /^<(\/?u|\/mark|mark(?:\s+(?:style="background(?:-color)?:\s*([^";]+?);?\s*"|data-color="([^"]+)"))?)>/i.exec(state.src.slice(state.pos));
    if (!m) return false;
    if (!silent) {
      const t = state.push('html_inline', '', 0);
      const tag = m[1].toLowerCase();
      const color = (m[2] || m[3] || '').trim();
      t.content = tag.startsWith('mark') ? (SAFE_COLOR.test(color) ? `<mark data-color="${color}">` : '<mark>') : `<${tag}>`;
    }
    state.pos += m[0].length;
    return true;
  });
}

const MarkdownHighlight = Highlight.extend({
  // outermost mark, like Highlightr writes it: <mark …>**bold**</mark>
  priority: 200,
  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state, mark) => (mark.attrs.color ? `<mark style="background: ${mark.attrs.color};">` : '=='),
          close: (_state, mark) => (mark.attrs.color ? '</mark>' : '=='),
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: { setup(md) { if (!md.__mark) { md.__mark = true; md.use(markPlugin); } htmlMarksMarkdownIt(md); } },
      },
    };
  },
}).configure({ multicolor: true });

const MarkdownUnderline = Underline.extend({
  priority: 150,
  addStorage() {
    return {
      markdown: {
        serialize: { open: '<u>', close: '</u>', mixable: true, expelEnclosingWhitespace: true },
        parse: { setup: htmlMarksMarkdownIt },
      },
    };
  },
});

// Show local images by routing relative paths through the vault file endpoint,
// while keeping the original `src` in the markdown.
const VaultImage = Image.extend({
  inline: true,
  group: 'inline',
  renderHTML({ HTMLAttributes }) {
    const src = HTMLAttributes.src || '';
    const shown = /^(https?:|data:|blob:)/.test(src) ? src : host.resolveAsset(decodeURI(src)) || src;
    return ['img', mergeAttributes(HTMLAttributes, { src: shown, 'data-src': src, loading: 'lazy' })];
  },
});

const lowlight = createLowlight(common);
const CodeBlock = CodeBlockLowlight.extend({
  renderHTML({ node, HTMLAttributes }) {
    return ['pre', mergeAttributes(HTMLAttributes, { 'data-language': node.attrs.language || 'plain text' }),
      ['code', { class: node.attrs.language ? `language-${node.attrs.language}` : null }, 0]];
  },
}).configure({ lowlight, defaultLanguage: null });

// ------------------------------------------------------------------ decorations: #tags and callouts
const CALLOUTS = {
  note: 'info', info: 'info', abstract: 'book', summary: 'book', tldr: 'book', todo: 'check', tip: 'tip',
  hint: 'tip', important: 'flame', success: 'success', check: 'success', done: 'success', question: 'note',
  help: 'note', faq: 'note', warning: 'warning', caution: 'warning', attention: 'warning', failure: 'x',
  fail: 'x', missing: 'x', danger: 'error', error: 'error', bug: 'error', example: 'library', quote: 'quote', cite: 'quote',
};
const TAG_RE = /(^|[\s(])(#[\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

function buildDecorations(doc) {
  const decos = [];
  doc.descendants((node, pos, parent) => {
    if (node.type.name === 'codeBlock') return false;
    if (node.type.name === 'blockquote') {
      const first = node.firstChild;
      const m = first?.textContent.match(/^\[!([\w-]+)\]([+-]?)/);
      if (first && m) {
        const type = m[1].toLowerCase();
        const kind = CALLOUTS[type] ? type : 'note';
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `callout callout-${kind}`, 'data-callout': type }));
        const start = pos + 2; // inside blockquote > paragraph
        decos.push(Decoration.widget(start, () => h(`<span class="callout-icon" contenteditable="false">${icon(CALLOUTS[kind] || 'info', 17)}</span>`), { side: -1 }));
        decos.push(Decoration.inline(start, start + 2, { class: 'cm-hide' }));
        decos.push(Decoration.inline(start + 2, start + 2 + m[1].length, { class: 'callout-label' }));
        decos.push(Decoration.inline(start + 2 + m[1].length, start + m[0].length, { class: 'cm-hide' }));
        // the rest of the first line is the callout's title
        let titleEnd = first.content.size;
        first.forEach((child, offset) => { if (child.type.name === 'hardBreak' && offset < titleEnd) titleEnd = offset; });
        if (titleEnd > m[0].length) decos.push(Decoration.inline(start + m[0].length, start + titleEnd, { class: 'callout-title' }));
      }
    }
    if (node.isText && parent.type.name !== 'codeBlock' && !node.marks.some((mk) => mk.type.name === 'code' || mk.type.name === 'link')) {
      for (const m of node.text.matchAll(TAG_RE)) {
        const from = pos + m.index + m[1].length;
        decos.push(Decoration.inline(from, from + m[2].length, { class: 'tag' }));
      }
    }
    return true;
  });
  return DecorationSet.create(doc, decos);
}

const Decorations = Extension.create({
  name: 'localNotesDecorations',
  addProseMirrorPlugins() {
    const key = new PluginKey('lnDecorations');
    return [new Plugin({
      key,
      state: {
        init: (_, { doc }) => buildDecorations(doc),
        apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
      },
      props: { decorations: (state) => key.getState(state) },
    })];
  },
});

// ------------------------------------------------------------------ suggestion menus (slash + [[)
class SuggestMenu {
  constructor(kind) {
    this.kind = kind;
    this.index = 0;
    this.el = h(`<div class="suggest pop suggest-${kind}" role="listbox"></div>`);
    document.body.append(this.el);
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
  }

  update(props) {
    this.props = props;
    this.items = props.items;
    if (this.index >= this.items.length) this.index = 0;
    this.render();
    this.position();
  }

  render() {
    const { items, kind } = this;
    if (!items.length) {
      this.el.innerHTML = `<div class="suggest-empty">${kind === 'slash' ? 'No matching blocks' : 'No matching pages'}</div>`;
      return;
    }
    let html = '';
    let group = null;
    items.forEach((it, i) => {
      if (it.group && it.group !== group) { group = it.group; html += `<div class="suggest-group">${esc(group)}</div>`; }
      html += kind === 'slash'
        ? `<button class="suggest-item ${i === this.index ? 'active' : ''}" data-i="${i}">
            <span class="si-thumb">${icon(it.icon, 18, 1.6)}</span>
            <span class="si-body"><span class="si-title">${esc(it.title)}</span><span class="si-desc">${esc(it.desc)}</span></span>
            ${it.md ? `<span class="si-md">${esc(it.md)}</span>` : ''}</button>`
        : `<button class="suggest-item compact ${i === this.index ? 'active' : ''}" data-i="${i}">
            <span class="si-icon">${icon(it.create ? 'plus' : 'page', 16)}</span>
            <span class="si-title">${it.create ? `Link to new page “${esc(it.name)}”` : esc(it.name)}</span>
            ${it.folder ? `<span class="si-folder">${esc(it.folder)}</span>` : ''}</button>`;
    });
    this.el.innerHTML = html;
    this.el.querySelectorAll('[data-i]').forEach((b) => {
      b.addEventListener('click', () => this.select(+b.dataset.i));
      b.addEventListener('mousemove', () => { if (this.index !== +b.dataset.i) { this.index = +b.dataset.i; this.highlight(); } });
    });
  }

  highlight() {
    this.el.querySelectorAll('[data-i]').forEach((b) => b.classList.toggle('active', +b.dataset.i === this.index));
    this.el.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  position() {
    const rect = this.props.clientRect?.();
    if (!rect) return;
    const w = this.el.offsetWidth, ht = this.el.offsetHeight;
    let top = rect.bottom + 8;
    if (top + ht > innerHeight - 12) top = Math.max(12, rect.top - ht - 8);
    this.el.style.left = `${Math.min(rect.left, innerWidth - w - 12)}px`;
    this.el.style.top = `${top}px`;
  }

  select(i) {
    const item = this.items[i];
    if (item) this.props.command(item);
  }

  onKeyDown(e) {
    if (e.key === 'Escape') { this.destroy(); return true; }
    if (!this.items.length) return false;
    if (e.key === 'ArrowDown') { this.index = (this.index + 1) % this.items.length; this.highlight(); return true; }
    if (e.key === 'ArrowUp') { this.index = (this.index - 1 + this.items.length) % this.items.length; this.highlight(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { this.select(this.index); return true; }
    return false;
  }

  destroy() { this.el.remove(); }
}

function menuRenderer(kind) {
  return () => {
    let menu;
    return {
      onStart: (props) => { menu = new SuggestMenu(kind); menu.update(props); },
      onUpdate: (props) => menu?.update(props),
      onKeyDown: ({ event }) => menu?.onKeyDown(event) ?? false,
      onExit: () => { menu?.destroy(); menu = null; },
    };
  };
}

const BLOCKS = [
  { group: 'AI', title: 'Write with AI', desc: 'Draft, continue, brainstorm or summarize', icon: 'sparkles', keys: 'ai write generate assistant claude gpt gemini llm', run: (c) => { setTimeout(() => host.aiWrite?.()); return c; } },
  { group: 'Basic blocks', title: 'Text', desc: 'Just start writing with plain text', icon: 'text', keys: 'paragraph plain p', run: (c) => c.setParagraph() },
  { group: 'Basic blocks', title: 'Heading 1', desc: 'Big section heading', icon: 'h1', md: '#', keys: 'h1 title', run: (c) => c.setHeading({ level: 1 }) },
  { group: 'Basic blocks', title: 'Heading 2', desc: 'Medium section heading', icon: 'h2', md: '##', keys: 'h2 subtitle', run: (c) => c.setHeading({ level: 2 }) },
  { group: 'Basic blocks', title: 'Heading 3', desc: 'Small section heading', icon: 'h3', md: '###', keys: 'h3', run: (c) => c.setHeading({ level: 3 }) },
  { group: 'Basic blocks', title: 'Bulleted list', desc: 'Create a simple bulleted list', icon: 'bullet', md: '-', keys: 'ul unordered bullet', run: (c) => c.toggleBulletList() },
  { group: 'Basic blocks', title: 'Numbered list', desc: 'Create a list with numbering', icon: 'numbered', md: '1.', keys: 'ol ordered number', run: (c) => c.toggleOrderedList() },
  { group: 'Basic blocks', title: 'To-do list', desc: 'Track tasks with a checklist', icon: 'todo', md: '[]', keys: 'todo task check checkbox', run: (c) => c.toggleTaskList() },
  { group: 'Basic blocks', title: 'Quote', desc: 'Capture a quote', icon: 'quote', md: '>', keys: 'blockquote citation', run: (c) => c.setParagraph().toggleBlockquote() },
  { group: 'Basic blocks', title: 'Divider', desc: 'Visually divide blocks', icon: 'divider', md: '---', keys: 'hr rule line separator', run: (c) => c.setHorizontalRule() },
  { group: 'Advanced', title: 'Callout', desc: 'Make writing stand out', icon: 'tip', keys: 'callout note info admonition', run: (c) => c.setParagraph().toggleBlockquote().insertContent('[!note] ') },
  { group: 'Advanced', title: 'Code', desc: 'Capture a code snippet', icon: 'code', md: '```', keys: 'code snippet pre', run: (c) => c.setCodeBlock() },
  { group: 'Advanced', title: 'Table', desc: 'Add a simple table', icon: 'table', keys: 'table grid', run: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  { group: 'Advanced', title: 'Link to page', desc: 'Link to another note in this vault', icon: 'page-link', md: '[[', keys: 'wiki link page mention', run: (c) => c.insertContent('[[') },
  { group: 'Advanced', title: 'Template', desc: 'Insert one of your templates', icon: 'template', keys: 'template snippet boilerplate', run: (c) => { setTimeout(() => host.insertTemplate?.()); return c; } },
];

function filterBlocks(query) {
  const q = query.toLowerCase();
  if (!q) return BLOCKS;
  return BLOCKS.filter((b) => b.title.toLowerCase().includes(q) || b.keys.includes(q));
}

const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [Suggestion({
      editor: this.editor,
      pluginKey: new PluginKey('slash'),
      char: '/',
      allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== 'codeBlock',
      items: ({ query }) => filterBlocks(query),
      command: ({ editor, range, props }) => props.run(editor.chain().focus().deleteRange(range)).run(),
      render: menuRenderer('slash'),
    })];
  },
});

const WikiSuggest = Extension.create({
  name: 'wikiSuggest',
  addProseMirrorPlugins() {
    return [Suggestion({
      editor: this.editor,
      pluginKey: new PluginKey('wikiSuggest'),
      char: '[[',
      allowSpaces: true,
      allowedPrefixes: null,
      allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== 'codeBlock',
      items: ({ query }) => {
        const q = query.replace(/\]+$/, '');
        const list = host.noteSuggestions(q).slice(0, 8);
        if (q.trim() && !list.some((n) => n.name.toLowerCase() === q.trim().toLowerCase())) list.push({ name: q.trim(), create: true });
        return list;
      },
      command: ({ editor, range, props }) => {
        // swallow an auto-typed closing ]] if present
        const after = editor.state.doc.textBetween(range.to, Math.min(range.to + 2, editor.state.doc.content.size));
        const to = after === ']]' ? range.to + 2 : range.to;
        editor.chain().focus().insertContentAt({ from: range.from, to }, [
          { type: 'wikilink', attrs: { target: props.name } }, { type: 'text', text: ' ' },
        ]).run();
      },
      render: menuRenderer('wiki'),
    })];
  },
});

// Typing "[[" when the menu is dismissed shouldn't strand the user; Ctrl/Cmd+K turns a selection into a link.
const Shortcuts = Extension.create({
  name: 'lnShortcuts',
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-h': () => this.editor.commands.toggleHighlight(),
      'Mod-e': () => this.editor.commands.toggleCode(),
    };
  },
});

// ------------------------------------------------------------------ team: comments & cursors
// Comment anchors live in the shared document as a mark, so they move with the text for
// everyone. They serialize to nothing, keeping the markdown clean.
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return { thread: { default: null, parseHTML: (el) => el.getAttribute('data-thread'), renderHTML: (a) => ({ 'data-thread': a.thread }) } };
  },
  parseHTML() { return [{ tag: 'span[data-thread]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { class: 'comment-mark' }), 0]; },
  addStorage() {
    return { markdown: { serialize: { open: '', close: '', mixable: true, expelEnclosingWhitespace: true }, parse: {} } };
  },
});

function renderCursor(user) {
  const caret = document.createElement('span');
  caret.className = 'collab-caret';
  caret.style.setProperty('--c', user.color);
  const label = document.createElement('span');
  label.className = 'collab-label';
  label.textContent = user.name;
  caret.append(label);
  return caret;
}

// ------------------------------------------------------------------ factory
// `collab`: { doc, provider, user: {name, color} } turns on live co-editing (Yjs owns undo history).
export function createEditor({ element, bubble, onUpdate, collab = null, editable = true, handleSelector = '#block-handle' }) {
  const collabExtensions = collab ? [
    Collaboration.configure({ document: collab.doc, field: 'default' }),
    CollaborationCursor.configure({ provider: collab.provider, user: collab.user, render: renderCursor }),
    CommentMark,
  ] : [];
  const editor = new Editor({
    element,
    editable,
    extensions: [
      StarterKit.configure({ codeBlock: false, text: false, hardBreak: false, italic: false, history: collab ? false : undefined, dropcursor: { color: 'var(--accent)', width: 2 } }),
      ...collabExtensions,
      GentleText, ObsidianHardBreak, TightTaskLists, AttachedLists, StyledItalic,
      Placeholder.configure({
        includeChildren: false,
        placeholder: ({ node, editor: ed }) => {
          if (node.type.name === 'heading') return `Heading ${node.attrs.level}`;
          if (ed.isEmpty) return 'Start writing, or press ‘/’ for commands…';
          return 'Type ‘/’ for commands';
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: 'noopener', target: null } }),
      VaultImage,
      Table.configure({ resizable: false }),
      TableRow, TableHeader, TableCell,
      CodeBlock,
      MarkdownHighlight, MarkdownUnderline,
      WikiLink, WikiEmbed,
      Decorations,
      SlashCommand, WikiSuggest, Shortcuts,
      GlobalDragHandle.configure({ dragHandleWidth: 24, scrollTreshold: 120, dragHandleSelector: handleSelector }),
      BubbleMenu.configure({
        element: bubble,
        tippyOptions: { duration: [140, 90], placement: 'top', maxWidth: 'none', offset: [0, 10], zIndex: 40, appendTo: () => document.body },
        shouldShow: ({ editor: ed, state, from, to }) => {
          if (from === to || !ed.isEditable) return false;
          const node = state.selection.node;
          if (node) return false;
          if (ed.isActive('codeBlock')) return false;
          return state.doc.textBetween(from, to).trim().length > 0;
        },
      }),
      Markdown.configure({ html: false, tightLists: true, bulletListMarker: '-', linkify: false, breaks: true, transformPastedText: true, transformCopiedText: false }),
    ],
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'true' },
      handleClick(view, pos, event) {
        const wl = event.target.closest?.('.wikilink');
        if (wl) { host.openLink({ wikilink: wl.dataset.wikilink }); return true; }
        const a = event.target.closest?.('a[href]');
        if (a) { host.openLink(a.getAttribute('href')); return true; }
        return false;
      },
    },
    onUpdate: ({ editor: ed, transaction }) => onUpdate?.(ed, transaction),
  });
  return editor;
}

// Replace the document without polluting undo history or firing an update.
export function loadMarkdown(editor, markdown) {
  editor.commands.setContent(markdown, false, { preserveWhitespace: false });
  const { state } = editor;
  editor.view.updateState(EditorState.create({ doc: state.doc, plugins: state.plugins, selection: undefined }));
}

export function getMarkdown(editor) {
  return editor.storage.markdown.getMarkdown();
}

export { BLOCKS };
