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

export const TEXT_SIZES = [
  ['Small', '0.85em'],
  ['Normal', null],
  ['Large', '1.3em'],
  ['Huge', '1.75em'],
];

// Text colours that remain readable in both themes; the first entry is "no
// override", which removes only the colour and keeps any font size.
export const TEXT_COLORS = [
  ['Default', null, 'var(--text)'],
  ['Ink', '#2b2a27', '#2b2a27'],
  ['Brick', '#b5422f', '#b5422f'],
  ['Forest', '#2f7d4f', '#2f7d4f'],
  ['Ocean', '#2563a8', '#2563a8'],
  ['Violet', '#7048b6', '#7048b6'],
  ['Amber', '#a16207', '#a16207'],
];

const currentStyle = (editor) => editor.getAttributes('textStyle') || {};

export function applyTextStyle(editor, patch, range = null) {
  const next = { ...currentStyle(editor), ...patch };
  for (const key of Object.keys(next)) if (!next[key]) delete next[key];
  const chain = editor.chain().focus();
  if (range) chain.setTextSelection(range);
  // setMark merges with an existing textStyle mark, so clear the old one first;
  // otherwise removing a size/colour attribute leaves the old value in place.
  chain.unsetMark('textStyle');
  if (Object.keys(next).length) chain.setMark('textStyle', next);
  chain.run();
}

export function openTextSizeMenu(editor, anchor) {
  const current = currentStyle(editor).fontSize || null;
  const range = { from: editor.state.selection.from, to: editor.state.selection.to };
  showMenu([
    { header: 'Text size' },
    ...TEXT_SIZES.map(([label, size]) => ({
      label,
      icon: 'text',
      checked: (current || null) === size,
      run: () => applyTextStyle(editor, { fontSize: size }, range),
    })),
  ], anchor, { className: 'size-menu' });
}

export function openTextColorMenu(editor, anchor) {
  const current = currentStyle(editor).color || null;
  const range = { from: editor.state.selection.from, to: editor.state.selection.to };
  const grid = h(`<div class="hl-grid color-grid">${TEXT_COLORS.map(([name, color, swatch]) => `
    <button class="hl-swatch ${(current || null) === (color || null) ? 'on' : ''}" data-color="${color || ''}" title="${esc(name)}" aria-label="${esc(name)} text colour">
      <span style="background:${swatch}"></span></button>`).join('')}</div>`);
  grid.addEventListener('mousedown', (e) => e.preventDefault());
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    applyTextStyle(editor, { color: b.dataset.color || null }, range);
    document.querySelector('.menu')?.remove();
  });
  showMenu([
    { header: 'Text colour' },
    { custom: grid },
    ...(current ? ['sep', { label: 'Remove colour', icon: 'eraser', run: () => applyTextStyle(editor, { color: null }, range) }] : []),
  ], anchor, { className: 'color-menu' });
}

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
  <button data-cmd="size" class="bb-size" title="Text size"><span>Aa</span></button>
  <button data-cmd="color" class="bb-color" title="Text colour"><span>A</span><i class="bb-color-dot"></i></button>
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
    case 'size': openTextSizeMenu(editor, button); break;
    case 'color': openTextColorMenu(editor, button); break;
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
  const style = currentStyle(editor);
  const sizeLabel = TEXT_SIZES.find(([, size]) => (size || null) === (style.fontSize || null))?.[0] || 'Aa';
  const sizeButton = el.querySelector('[data-cmd="size"] span');
  if (sizeButton) sizeButton.textContent = style.fontSize ? sizeLabel : 'Aa';
  const colorDot = el.querySelector('.bb-color-dot');
  if (colorDot) colorDot.style.background = style.color || 'transparent';
  const dot = el.querySelector('.bb-hl-dot');
  if (dot) {
    const color = editor.isActive('highlight') ? (editor.getAttributes('highlight').color || '#FFF3A3') : null;
    dot.style.background = color || 'transparent';
  }
}
