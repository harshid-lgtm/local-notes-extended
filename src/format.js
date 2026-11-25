// Formatting helpers shared by the local and team selection toolbars.
import { icon } from './icons.js';
import { h, esc, showMenu } from './ui.js';

// Same colours (and alpha) as Obsidian's Highlightr plugin, so highlights look alike in both apps.
// Yellow has no colour: it saves as ==text==.
export const HIGHLIGHTS = [
  ['Yellow', null, '#FFF3A3'],
  ['Green', '#BBFABBA6', '#BBFABB'],
  ['Blue', '#ADCCFFA6', '#ADCCFF'],
  ['Purple', '#D2B3FFA6', '#D2B3FF'],
  ['Pink', '#FFB8EBA6', '#FFB8EB'],
  ['Orange', '#FFB86CA6', '#FFB86C'],
  ['Red', '#FF5582A6', '#FF5582'],
  ['Gray', '#CACFD9A6', '#CACFD9'],
];

export function setHighlight(editor, color) {
  const chain = editor.chain().focus().unsetHighlight();
  (color === undefined ? chain : chain.setHighlight(color ? { color } : {})).run();
}

export function openHighlightMenu(editor, anchor) {
  const current = editor.isActive('highlight') ? (editor.getAttributes('highlight').color || null) : undefined;
  const grid = h(`<div class="hl-grid">${HIGHLIGHTS.map(([name, color, swatch]) => `
    <button class="hl-swatch ${current === color ? 'on' : ''}" data-color="${color || ''}" title="${esc(name)}" aria-label="${esc(name)} highlight">
      <span style="background:${swatch}"></span></button>`).join('')}</div>`);
  grid.addEventListener('mousedown', (e) => e.preventDefault());
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    setHighlight(editor, b.dataset.color || null);
    document.querySelector('.menu')?.remove();
  });
  showMenu([
    { header: 'Highlight' },
    { custom: grid },
    ...(current !== undefined ? ['sep', { label: 'Remove highlight', icon: 'eraser', run: () => setHighlight(editor, undefined) }] : []),
  ], anchor, { className: 'hl-menu' });
}

export function toggleList(editor, kind) {
  const c = editor.chain().focus();
  if (kind === 'bullet') c.toggleBulletList().run();
  else if (kind === 'numbered') c.toggleOrderedList().run();
  else c.toggleTaskList().run();
}

// Toolbar buttons (HTML) for the bubble menus.
export const formatButtons = (modKey) => `
  <button data-cmd="bold" title="Bold (${modKey}+B)">${icon('bold', 16, 2.2)}</button>
  <button data-cmd="italic" title="Italic (${modKey}+I)">${icon('italic', 16, 2)}</button>
  <button data-cmd="underline" title="Underline (${modKey}+U)">${icon('underline', 16, 2)}</button>
  <button data-cmd="strike" title="Strikethrough">${icon('strike', 16, 2)}</button>
  <button data-cmd="code" title="Inline code (${modKey}+E)">${icon('code', 16, 2)}</button>
  <button data-cmd="highlight" class="bb-hl" title="Highlight colour">${icon('highlight', 16, 2)}<i class="bb-hl-dot"></i></button>
  <span class="bb-sep"></span>
  <button data-cmd="bullet" title="Bulleted list">${icon('bullet', 16, 2)}</button>
  <button data-cmd="numbered" title="Numbered list">${icon('numbered', 16, 2)}</button>
  <button data-cmd="todo" title="To-do list">${icon('todo', 16, 2)}</button>`;

// Runs a shared toolbar command; returns false if the command isn't one of these.
export function runFormat(editor, cmd, button) {
  const c = editor.chain().focus();
  switch (cmd) {
    case 'bold': c.toggleBold().run(); break;
    case 'italic': c.toggleItalic().run(); break;
    case 'underline': c.toggleUnderline().run(); break;
    case 'strike': c.toggleStrike().run(); break;
    case 'code': c.toggleCode().run(); break;
    case 'highlight': openHighlightMenu(editor, button); break;
    case 'bullet': toggleList(editor, 'bullet'); break;
    case 'numbered': toggleList(editor, 'numbered'); break;
    case 'todo': toggleList(editor, 'todo'); break;
    default: return false;
  }
  return true;
}

export function syncFormat(editor, el) {
  for (const k of ['bold', 'italic', 'underline', 'strike', 'code', 'highlight']) el.querySelector(`[data-cmd="${k}"]`)?.classList.toggle('on', editor.isActive(k));
  el.querySelector('[data-cmd="bullet"]')?.classList.toggle('on', editor.isActive('bulletList'));
  el.querySelector('[data-cmd="numbered"]')?.classList.toggle('on', editor.isActive('orderedList'));
  el.querySelector('[data-cmd="todo"]')?.classList.toggle('on', editor.isActive('taskList'));
  const dot = el.querySelector('.bb-hl-dot');
  if (dot) {
    const color = editor.isActive('highlight') ? (editor.getAttributes('highlight').color || '#FFF3A3') : null;
    dot.style.background = color || 'transparent';
  }
}
