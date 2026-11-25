import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import { api } from './api.js';
import { icon, logo } from './icons.js';
import { $, h, esc, showMenu, closeMenu, place, openModal, confirmDialog, toast, store, timeAgo, modKey, copyText, downloadBlob } from './ui.js';
import { createEditor, loadMarkdown, getMarkdown, host, sniffStyle } from './editor.js';
import { Selection } from '@tiptap/pm/state';
import { formatButtons, runFormat, syncFormat } from './format.js';
import { mountGraph, folderColor, setFolders } from './graph.js';
import { showTeamSignIn, startTeam, showOfflinePage } from './team/team.js';
import { savedTeams } from './team/client.js';
import { openAIMenu, openWritePanel, summarizePage, toggleAskPanel, openAISettings, setAIHooks, closeAskPanel } from './ai/ai.js';

// ================================================================== state
const S = {
  boot: null,          // /api/state payload
  vault: null,
  tree: [],
  files: [],
  notes: [],           // flat [{path, name, folder, mtime}]
  current: null,       // {path, mtime, fm, eol, dirty}
  expanded: new Set(),
  favorites: [],
  recents: [],
  templateFolder: 'Templates',
};

const prefs = {
  theme: 'system', font: 'sans', small: false, wide: false, sidebar: 264, collapsed: false,
  ...store.get('ln:prefs', {}),
};
const savePrefs = () => store.set('ln:prefs', prefs);
const vaultKey = (k) => `ln:${S.vault.path}:${k}`;
const persistVault = () => {
  store.set(vaultKey('expanded'), [...S.expanded]);
  store.set(vaultKey('favorites'), S.favorites);
  store.set(vaultKey('recents'), S.recents);
};

let editor;
let opQueue = Promise.resolve();
const enqueue = (fn) => (opQueue = opQueue.then(fn, fn));

// ================================================================== theme & prefs
function applyPrefs() {
  const root = document.documentElement;
  root.dataset.theme = prefs.theme === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : prefs.theme;
  root.dataset.font = prefs.font;
  root.classList.toggle('small-text', prefs.small);
  root.classList.toggle('full-width', prefs.wide);
  root.style.setProperty('--sidebar-w', `${prefs.sidebar}px`);
  document.body.classList.toggle('sidebar-collapsed', prefs.collapsed);
  window.desktop?.setTheme(root.dataset.theme === 'dark');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyPrefs);

// ================================================================== paths & resolution
const baseName = (p) => p.split('/').pop();
const dirName = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const stripMd = (p) => p.replace(/\.md$/i, '');
const joinPath = (...parts) => parts.filter(Boolean).join('/');

function resolveRelative(from, rel) {
  const out = from ? from.split('/') : [];
  for (const part of rel.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

function resolveNote(target) {
  if (!target) return null;
  const t = stripMd(target.split('#')[0].trim()).toLowerCase();
  if (!t) return S.current?.path ?? null;
  const exact = S.notes.find((n) => stripMd(n.path).toLowerCase() === t);
  if (exact) return exact.path;
  const candidates = S.notes.filter((n) => n.name.toLowerCase() === baseName(t) || stripMd(n.path).toLowerCase().endsWith(`/${t}`));
  candidates.sort((a, b) => a.path.length - b.path.length);
  return candidates[0]?.path ?? null;
}

function resolveAsset(target) {
  if (!target) return null;
  const clean = target.split('#')[0].replace(/^\.\//, '');
  const here = S.current ? dirName(S.current.path) : '';
  const rel = resolveRelative(here, clean);
  const lower = clean.toLowerCase();
  const hit = S.files.find((f) => f === rel)
    || S.files.find((f) => f === clean)
    || S.files.find((f) => f.toLowerCase().endsWith(`/${lower}`) || f.toLowerCase() === lower);
  return hit ? api.fileUrl(hit) : null;
}

function fuzzyNotes(query, limit = 50) {
  const q = query.trim().toLowerCase();
  if (!q) return [...S.notes].sort((a, b) => b.mtime - a.mtime).slice(0, limit);
  const scored = [];
  for (const n of S.notes) {
    const name = n.name.toLowerCase();
    let score = -1;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (n.path.toLowerCase().includes(q)) score = 40;
    else {
      let i = 0;
      for (const ch of name) if (ch === q[i]) i++;
      if (i === q.length) score = 20;
    }
    if (score >= 0) scored.push({ n, score });
  }
  scored.sort((a, b) => b.score - a.score || b.n.mtime - a.n.mtime);
  return scored.slice(0, limit).map((s) => s.n);
}

host.resolveNote = resolveNote;
host.resolveAsset = resolveAsset;
host.noteSuggestions = (q) => fuzzyNotes(q, 30).filter((n) => !n.path.startsWith(`${S.templateFolder}/`)).slice(0, 8).map((n) => ({ name: stripMd(n.path).includes('/') && S.notes.filter((m) => m.name === n.name).length > 1 ? stripMd(n.path) : n.name, path: n.path, folder: n.folder }));
host.openLink = async (href) => {
  if (href && typeof href === 'object') {
    const target = href.wikilink.split('|')[0];
    const path = resolveNote(target);
    if (path) return openNote(path);
    const name = baseName(target.split('#')[0]);
    const created = await api.create('', name);
    await refreshTree();
    toast(`Created “${created.name}”`, { kind: 'success' });
    return openNote(created.path);
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return window.open(href, '_blank', 'noopener');
  const target = decodeURI(href.split('#')[0]);
  const rel = resolveRelative(S.current ? dirName(S.current.path) : '', target);
  const path = S.notes.find((n) => n.path === rel || n.path === `${rel}.md`)?.path || resolveNote(target);
  if (path) return openNote(path);
  const asset = resolveAsset(target);
  if (asset) return window.open(asset, '_blank');
  toast(`Couldn’t find “${target}”`, { kind: 'error' });
};

// ================================================================== frontmatter
function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  return m ? { fm: m[0], yaml: m[1], body: text.slice(m[0].length) } : { fm: '', yaml: '', body: text };
}

function parseYamlish(yaml) {
  const props = [];
  let last = null;
  for (const line of yaml.split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && last) { last.values.push(item[1].replace(/^["']|["']$/g, '')); continue; }
    const kv = line.match(/^([\w][\w\s-]*):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    let values = [];
    if (value.startsWith('[') && value.endsWith(']')) values = value.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else if (value) values = [value.replace(/^["']|["']$/g, '')];
    last = { key: kv[1].trim(), values };
    props.push(last);
  }
  return props;
}

function renderProps(yaml) {
  const el = $('#props');
  const props = yaml ? parseYamlish(yaml) : [];
  el.hidden = !props.length;
  if (!props.length) { el.innerHTML = ''; return; }
  const iconFor = (k) => (/tag/i.test(k) ? 'hash' : /date|created|updated|time/i.test(k) ? 'clock' : /alias/i.test(k) ? 'switch' : /link|url|source/i.test(k) ? 'link' : 'text');
  el.innerHTML = props.map((p) => `
    <div class="prop">
      <div class="prop-key">${icon(iconFor(p.key), 14)}<span>${esc(p.key)}</span></div>
      <div class="prop-val">${p.values.length
        ? (/tag/i.test(p.key) || p.values.length > 1
          ? p.values.map((v) => `<span class="chip ${/tag/i.test(p.key) ? 'chip-tag' : ''}">${esc(v.replace(/^#/, ''))}</span>`).join('')
          : `<span>${esc(p.values[0])}</span>`)
        : '<span class="prop-empty">Empty</span>'}</div>
    </div>`).join('');
}

// ================================================================== welcome / vault selection
function showWelcome() {
  $('#shell').hidden = true;
  const w = $('#welcome');
  w.hidden = false;
  const { recent, obsidian } = S.boot;
  const list = (title, items, ic) => (items.length ? `
    <div class="wl-section"><div class="wl-label">${title}</div>
      ${items.map((v) => `<button class="vault-row" data-path="${esc(v.path)}">
        <span class="vault-tile" style="--hue:${hue(v.name)}">${esc(v.name[0]?.toUpperCase() || '·')}</span>
        <span class="vault-meta"><span class="vault-name">${esc(v.name)}</span><span class="vault-path">${esc(v.display)}</span></span>
        <span class="vault-go">${icon(ic, 16)}</span></button>`).join('')}
    </div>` : '');
  const obsidianOnly = obsidian.filter((o) => !recent.some((r) => r.path === o.path));
  w.innerHTML = `
    <div class="wl-bg" aria-hidden="true"><div class="wl-glow"></div><div class="wl-grid"></div></div>
    <div class="wl-wrap">
      <div class="wl-hero">
        <div class="wl-logo">${logo(56)}</div>
        <h1>Local Notes Extended</h1>
        <p>Your markdown files, beautifully simple. Pick any folder and it becomes your vault — everything stays on your computer.</p>
        <div class="wl-buttons">
          <button class="btn primary large" id="wl-choose">${icon('folder-open', 18)}<span>Open a folder</span></button>
          <button class="btn ghost large" id="wl-create">${icon('plus', 18)}<span>Create a new vault</span></button>
        </div>
        <div class="wl-hint">Works great with your existing Obsidian vault</div>
        <button class="wl-team" id="wl-team">${icon('library', 16)}<span>Working with a team? <b>Connect to a team server</b></span>${icon('arrow-right', 15)}</button>
      </div>
      ${recent.length || obsidianOnly.length || savedTeams().length ? `<div class="wl-card">
        ${list('Recent vaults', recent, 'arrow-right')}
        ${list('Found Obsidian vaults', obsidianOnly, 'arrow-right')}
        ${savedTeams().length ? `<div class="wl-section"><div class="wl-label">Team servers</div>${savedTeams().map((c) => `<button class="vault-row" data-team="${esc(c.url)}">
          <span class="vault-tile team" style="--hue:${hue(c.url)}">${icon('library', 17)}</span>
          <span class="vault-meta"><span class="vault-name">${esc(c.url.replace(/^https?:\/\//, ''))}</span><span class="vault-path">${esc(c.user?.name || '')} · ${esc(c.user?.email || '')}</span></span>
          <span class="vault-go">${icon('arrow-right', 16)}</span></button>`).join('')}</div>` : ''}
      </div>` : ''}
      <div class="wl-preview" aria-hidden="true">
        <div class="pv-side"><i></i><i></i><i class="on"></i><i></i><i></i></div>
        <div class="pv-page"><b></b><i style="width:82%"></i><i style="width:64%"></i><i class="pv-check"></i><i style="width:74%"></i><i style="width:40%"></i></div>
      </div>
    </div>`;
  $('#wl-choose').onclick = () => openFolderPicker();
  $('#wl-create').onclick = () => createVaultDialog();
  w.querySelectorAll('.vault-row[data-path]').forEach((b) => (b.onclick = () => chooseVault(b.dataset.path)));
  w.querySelectorAll('.vault-row[data-team]').forEach((b) => (b.onclick = () => openTeam(savedTeams().find((c) => c.url === b.dataset.team))));
  $('#wl-team').onclick = () => openTeam(null);
}

function hue(s) {
  let x = 0;
  for (const c of s || '') x = (x * 31 + c.charCodeAt(0)) % 360;
  return x;
}

async function chooseVault(path) {
  try {
    const { vault } = await api.setVault(path);
    await openVault(vault);
  } catch (e) {
    toast(e.message, { kind: 'error' });
  }
}

async function openFolderPicker({ onPick = null } = {}) {
  if (window.desktop) {
    const p = await window.desktop.pickFolder(onPick ? { title: 'Choose a location', button: 'Choose' } : {});
    if (p) { if (onPick) onPick(p); else await chooseVault(p); }
    return;
  }
  const { shortcuts, obsidian, recent } = S.boot;
  const box = h(`<div class="picker">
    <div class="pk-head">
      <div class="pk-title"><h2>Choose a vault folder</h2><p>Any folder of markdown files works. New notes are saved there as <code>.md</code> files.</p></div>
      <button class="icon-btn" data-close aria-label="Close">${icon('x', 18)}</button>
    </div>
    <div class="pk-body">
      <nav class="pk-nav">
        <div class="pk-label">Places</div>
        ${shortcuts.map((s) => `<button class="pk-place" data-path="${esc(s.path)}">${icon(s.label.startsWith('C:') ? 'drive' : s.label === 'Home' ? 'home' : 'folder', 16)}<span>${esc(s.label)}</span></button>`).join('')}
        ${obsidian.length ? `<div class="pk-label">Obsidian vaults</div>${obsidian.map((o) => `<button class="pk-place" data-path="${esc(o.path)}">${icon('book', 16)}<span>${esc(o.name)}</span></button>`).join('')}` : ''}
        ${recent.length ? `<div class="pk-label">Recent</div>${recent.map((o) => `<button class="pk-place" data-path="${esc(o.path)}">${icon('clock', 16)}<span>${esc(o.name)}</span></button>`).join('')}` : ''}
      </nav>
      <section class="pk-main">
        <form class="pk-path"><span>${icon('folder', 16)}</span><input spellcheck="false" placeholder="Type or paste a path, e.g. C:\\Users\\you\\Notes" /><button class="btn ghost small" type="submit">Go</button></form>
        <div class="pk-crumbs"></div>
        <div class="pk-list" tabindex="-1"></div>
      </section>
    </div>
    <div class="pk-foot">
      <div class="pk-status"></div>
      <div class="pk-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-open>${icon('check', 16, 2)}<span>Open this folder</span></button></div>
    </div>
  </div>`);
  const modal = openModal(box, { className: 'picker-modal' });
  const input = $('.pk-path input', box);
  let cur = null;

  async function go(path) {
    try {
      const d = await api.browse(path);
      cur = d;
      input.value = d.display;
      $('.pk-crumbs', box).innerHTML = d.crumbs.map((c, i) => `${i ? `<span class="sep">${icon('chevron-right', 13)}</span>` : ''}<button data-path="${esc(c.path)}">${esc(c.name)}</button>`).join('');
      $('.pk-list', box).innerHTML = d.dirs.length
        ? d.dirs.map((x) => `<button class="pk-dir" data-path="${esc(x.path)}">${icon(x.isVault ? 'book' : 'folder', 17)}<span>${esc(x.name)}</span>${x.isVault ? '<em>Obsidian vault</em>' : ''}${icon('chevron-right', 15)}</button>`).join('')
        : `<div class="pk-empty">${icon('folder-open', 28, 1.4)}<span>No sub-folders here</span></div>`;
      $('.pk-status', box).innerHTML = `<strong>${esc(d.name)}</strong> · ${d.mdCount} markdown file${d.mdCount === 1 ? '' : 's'} at this level${d.isVault ? ' · <span class="ok">Obsidian vault</span>' : ''}`;
      box.querySelectorAll('.pk-place').forEach((b) => b.classList.toggle('active', b.dataset.path === d.path));
      $('.pk-list', box).scrollTop = 0;
    } catch (e) {
      toast(e.message, { kind: 'error' });
    }
  }

  box.addEventListener('click', (e) => {
    const t = e.target.closest('[data-path]');
    if (t) go(t.dataset.path);
    if (e.target.closest('[data-close]')) modal.close();
  });
  box.addEventListener('dblclick', (e) => {
    const t = e.target.closest('.pk-dir');
    if (t && !onPick) chooseVault(t.dataset.path).then(() => modal.close());
  });
  $('.pk-path', box).addEventListener('submit', (e) => { e.preventDefault(); go(input.value); });
  if (onPick) $('[data-open] span', box).textContent = 'Choose this folder';
  $('[data-open]', box).onclick = async () => {
    if (!cur) return;
    if (onPick) { modal.close(); onPick(cur.path); return; }
    await chooseVault(cur.path);
    modal.close();
  };
  go(S.vault?.path || recent[0]?.path || null);
}

function createVaultDialog() {
  const docs = S.boot.shortcuts.find((s) => s.label === 'Documents') || S.boot.shortcuts[0];
  let parent = docs?.path || S.boot.home;
  const box = h(`<div class="cv">
    <div class="cv-art">${logo(44)}</div>
    <h3>Create a new vault</h3>
    <p>A vault is a folder on your computer. Every page you write becomes a markdown file inside it.</p>
    <label class="field"><span>Name</span><input class="cv-name" value="My Notes" spellcheck="false"></label>
    <div class="field"><span>Location</span><div class="cv-loc"><code></code><button class="btn ghost small" data-change>Change…</button></div></div>
    <div class="confirm-actions"><button class="btn ghost" data-no>Cancel</button><button class="btn primary" data-yes>Create vault</button></div>
  </div>`);
  const m = openModal(box, { className: 'small' });
  const show = () => { $('.cv-loc code', box).textContent = parent; };
  show();
  const name = $('.cv-name', box);
  setTimeout(() => { name.focus(); name.select(); }, 30);
  $('[data-change]', box).onclick = () => openFolderPicker({ onPick: (p) => { parent = p; show(); } });
  $('[data-no]', box).onclick = () => m.close();
  const go = async () => {
    try {
      const { vault } = await api.createVault(parent, name.value);
      m.close();
      await openVault(vault);
      toast('Vault created', { kind: 'success' });
    } catch (e) { toast(e.message, { kind: 'error' }); }
  };
  $('[data-yes]', box).onclick = go;
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

// ================================================================== vault
async function openVault(vault) {
  S.vault = vault;
  S.expanded = new Set(store.get(vaultKey('expanded'), []));
  S.favorites = store.get(vaultKey('favorites'), []);
  S.recents = store.get(vaultKey('recents'), []);
  S.current = null;
  $('#welcome').hidden = true;
  $('#shell').hidden = false;
  $('#vault-name').textContent = vault.name;
  $('#vault-tile').textContent = vault.name[0]?.toUpperCase() || '·';
  $('#vault-tile').style.setProperty('--hue', hue(vault.name));
  document.title = `${vault.name} · Local Notes Extended`;
  api.templates().then((t) => { S.templateFolder = t.folder; }).catch(() => {});
  await refreshTree();
  const fromHash = decodeURIComponent(location.hash.slice(2));
  const start = [fromHash, S.recents[0]].find((p) => p && S.notes.some((n) => n.path === p));
  if (start) await openNote(start, { replace: true });
  else showHome();
}

async function refreshTree() {
  const data = await api.tree();
  S.tree = data.tree;
  S.files = data.files;
  S.notes = [];
  const walk = (items) => items.forEach((it) => {
    if (it.type === 'note') S.notes.push({ path: it.path, name: it.name, folder: dirName(it.path), mtime: it.mtime });
    else walk(it.children);
  });
  walk(S.tree);
  const exists = new Set(S.notes.map((n) => n.path));
  S.favorites = S.favorites.filter((p) => exists.has(p));
  S.recents = S.recents.filter((p) => exists.has(p));
  renderTree();
  renderFavorites();
  if (!$('#home').hidden) renderHome();
}

// ================================================================== sidebar
// A page "X.md" with a sibling folder "X/" is shown as one page with subpages (wiki style).
function rowHTML(it, depth, sub = null) {
  const isFolder = it.type === 'folder';
  const container = isFolder ? it.path : sub?.path;
  const open = container && S.expanded.has(container);
  const active = !isFolder && S.current?.path === it.path;
  return `<div class="row ${isFolder ? 'folder' : 'note'} ${sub ? 'has-sub' : ''} ${active ? 'active' : ''} ${open ? 'open' : ''}" data-path="${esc(it.path)}" data-type="${it.type}" ${sub ? `data-sub="${esc(sub.path)}"` : ''} draggable="true" style="--depth:${depth}">
    <span class="twisty">${isFolder || sub ? icon('chevron-right', 14, 2) : ''}</span>
    <span class="row-icon">${isFolder ? icon(open ? 'folder-open' : 'folder', 16) : icon(sub ? 'book' : 'page', 16)}</span>
    <span class="row-label">${esc(it.name)}</span>
    <span class="row-actions">
      <button class="row-btn" data-act="more" title="More">${icon('more', 15)}</button>
      <button class="row-btn" data-act="add" title="${isFolder ? 'New page inside' : 'Add a subpage'}">${icon('plus', 15)}</button>
    </span>
  </div>`;
}

function treeHTML(items, depth) {
  const folders = new Map(items.filter((i) => i.type === 'folder').map((f) => [f.name.toLowerCase(), f]));
  const merged = new Set();
  for (const it of items) if (it.type === 'note' && folders.has(it.name.toLowerCase())) merged.add(folders.get(it.name.toLowerCase()));
  return items.map((it) => {
    if (merged.has(it)) return '';
    const sub = it.type === 'note' ? folders.get(it.name.toLowerCase()) : null;
    const container = it.type === 'folder' ? it : sub;
    let html = rowHTML(it, depth, sub);
    if (container && S.expanded.has(container.path)) {
      html += `<div class="children">${container.children.length ? treeHTML(container.children, depth + 1) : `<div class="row-empty" style="--depth:${depth + 1}">${sub ? 'No subpages' : 'No pages inside'}</div>`}</div>`;
    }
    return html;
  }).join('');
}

const subFolderOf = (notePath) => {
  const p = stripMd(notePath).toLowerCase();
  return S.notes.some((n) => n.path.toLowerCase().startsWith(`${p}/`)) ? stripMd(notePath) : null;
};

async function addSubpage(notePath) {
  const folder = stripMd(notePath);
  S.expanded.add(folder);
  await newNote(folder);
}

function renderTree() {
  const el = $('#tree');
  el.innerHTML = S.tree.length ? treeHTML(S.tree, 0) : `<div class="tree-empty">This vault is empty.<br><button class="link-btn" data-new>Create your first page</button></div>`;
  $('[data-new]', el)?.addEventListener('click', () => newNote(''));
  $('#page-count').textContent = S.notes.length || '';
}

function renderFavorites() {
  const sec = $('#fav-section');
  sec.hidden = !S.favorites.length;
  $('#favorites').innerHTML = S.favorites.map((p) => {
    const n = S.notes.find((x) => x.path === p);
    return n ? rowHTML({ type: 'note', path: p, name: n.name }, 0) : '';
  }).join('');
}

function markActive() {
  document.querySelectorAll('.sidebar .row.note').forEach((r) => r.classList.toggle('active', r.dataset.path === S.current?.path));
}

function revealInTree(path) {
  let changed = false;
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const p = parts.slice(0, i).join('/');
    if (!S.expanded.has(p)) { S.expanded.add(p); changed = true; }
  }
  if (changed) { renderTree(); persistVault(); }
  markActive();
  const row = document.querySelector(`#tree .row[data-path="${CSS.escape(path)}"]`);
  row?.scrollIntoView({ block: 'nearest' });
}

function toggleFolder(path) {
  if (S.expanded.has(path)) S.expanded.delete(path); else S.expanded.add(path);
  persistVault();
  renderTree();
}

function rowMenu(row, at) {
  const path = row.dataset.path;
  const isFolder = row.dataset.type === 'folder';
  const fav = S.favorites.includes(path);
  const items = isFolder
    ? [
      { label: 'New page', icon: 'file-plus', run: () => newNote(path) },
      { label: 'New folder', icon: 'folder-plus', run: () => newFolder(path) },
      'sep',
      { label: 'Rename', icon: 'pencil', run: () => inlineRename(row) },
      { label: 'Delete', icon: 'trash', danger: true, run: () => deleteItem(path, true) },
    ]
    : [
      { label: 'Add subpage', icon: 'file-plus', run: () => addSubpage(path) },
      { label: fav ? 'Remove from Favorites' : 'Add to Favorites', icon: 'star', run: () => toggleFavorite(path) },
      { label: 'Copy link', icon: 'page-link', run: () => copy(`[[${stripMd(baseName(path))}]]`, 'Wikilink copied') },
      { label: 'Open local graph', icon: 'graph', run: () => showGraph(path) },
      'sep',
      { label: 'Rename', icon: 'pencil', run: () => inlineRename(row) },
      { label: 'Delete', icon: 'trash', danger: true, run: () => deleteItem(path, false) },
    ];
  showMenu(items, at);
}

function inlineRename(row) {
  const label = $('.row-label', row);
  const path = row.dataset.path;
  const isFolder = row.dataset.type === 'folder';
  const old = isFolder ? baseName(path) : stripMd(baseName(path));
  const input = h(`<input class="row-input" value="${esc(old)}" spellcheck="false">`);
  label.replaceWith(input);
  row.draggable = false;
  input.focus();
  input.select();
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (commit && name && name !== old) await renamePath(path, joinPath(dirName(path), isFolder ? name : `${name}.md`));
    else renderTree();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

async function renamePath(from, to) {
  await flushSave();
  try {
    // Remap inside the queued step so a save queued behind this rename writes to the new path.
    const r = await enqueue(async () => {
      const res = await api.rename(from, to);
      const remap = (p) => (p === from ? res.path : p.startsWith(`${from}/`) ? res.path + p.slice(from.length) : p);
      S.favorites = S.favorites.map(remap);
      S.recents = S.recents.map(remap);
      S.expanded = new Set([...S.expanded].map(remap));
      if (S.current) {
        const np = remap(S.current.path);
        if (np !== S.current.path) { S.current.path = np; updatePageChrome(); history.replaceState(null, '', `#/${encodeURIComponent(np)}`); }
      }
      return res;
    });
    persistVault();
    await refreshTree();
    return r.path;
  } catch (e) {
    toast(e.message, { kind: 'error' });
    renderTree();
    return null;
  }
}

async function deleteItem(path, isFolder) {
  const name = isFolder ? baseName(path) : stripMd(baseName(path));
  const ok = await confirmDialog({
    title: `Delete “${name}”?`,
    body: `${isFolder ? 'The folder and everything inside it' : subFolderOf(path) ? 'This page and all of its subpages' : 'This page'} will be moved to the vault’s <code>.trash</code> folder, so you can still recover it.`,
    confirm: 'Move to trash',
    danger: true,
  });
  if (!ok) return;
  const affectsCurrent = S.current && (S.current.path === path || S.current.path.startsWith(`${path}/`));
  if (affectsCurrent) { S.current.dirty = false; clearTimeout(saveTimer); }
  await opQueue;
  try {
    await api.remove(path);
    toast(`Moved “${name}” to trash`);
    if (affectsCurrent) { S.current = null; showHome(); }
    await refreshTree();
  } catch (e) {
    toast(e.message, { kind: 'error' });
  }
}

function toggleFavorite(path) {
  const i = S.favorites.indexOf(path);
  if (i >= 0) S.favorites.splice(i, 1); else S.favorites.push(path);
  persistVault();
  renderFavorites();
  markActive();
  updatePageChrome();
}

async function newNote(folder = '') {
  try {
    const r = await api.create(folder, 'Untitled');
    if (folder) S.expanded.add(folder);
    await refreshTree();
    await openNote(r.path, { fresh: true });
  } catch (e) {
    toast(e.message, { kind: 'error' });
  }
}

async function newFolder(parent = '') {
  try {
    const r = await api.createFolder(parent, 'New folder');
    if (parent) S.expanded.add(parent);
    S.expanded.add(r.path);
    persistVault();
    await refreshTree();
    const row = document.querySelector(`#tree .row[data-path="${CSS.escape(r.path)}"]`);
    if (row) inlineRename(row);
  } catch (e) {
    toast(e.message, { kind: 'error' });
  }
}

function copy(text, msg) {
  copyText(text).then((ok) => toast(ok ? msg : 'Couldn’t copy — select the text and press Ctrl+C', { kind: ok ? 'success' : 'error' }));
}

function wireSidebar() {
  const sb = $('#sidebar');
  sb.addEventListener('click', (e) => {
    const btn = e.target.closest('.row-btn');
    const row = e.target.closest('.row');
    if (!row || row.querySelector('.row-input')) return;
    if (btn) {
      e.stopPropagation();
      if (btn.dataset.act === 'more') rowMenu(row, btn);
      else if (row.dataset.type === 'folder') newNote(row.dataset.path);
      else addSubpage(row.dataset.path);
      return;
    }
    if (row.dataset.type === 'folder') toggleFolder(row.dataset.path);
    else if (row.dataset.sub && e.target.closest('.twisty')) toggleFolder(row.dataset.sub);
    else openNote(row.dataset.path);
  });
  sb.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    e.preventDefault();
    rowMenu(row, { x: e.clientX, y: e.clientY });
  });

  // drag & drop to move pages/folders between folders
  let dragPath = null;
  const tree = $('#tree');
  const clearDrop = () => document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
  sb.addEventListener('dragstart', (e) => {
    const row = e.target.closest?.('.row');
    if (!row) return;
    dragPath = row.dataset.path;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `[[${stripMd(baseName(dragPath))}]]`);
    row.classList.add('dragging');
  });
  sb.addEventListener('dragend', () => { dragPath = null; clearDrop(); document.querySelectorAll('.row.dragging').forEach((r) => r.classList.remove('dragging')); });
  tree.addEventListener('dragover', (e) => {
    if (!dragPath) return;
    e.preventDefault();
    clearDrop();
    const row = e.target.closest('.row');
    (row && row.dataset.path !== dragPath ? row : tree).classList.add('drop-target');
  });
  tree.addEventListener('dragleave', (e) => { if (!tree.contains(e.relatedTarget)) clearDrop(); });
  tree.addEventListener('drop', async (e) => {
    if (!dragPath) return;
    e.preventDefault();
    clearDrop();
    // dropping on a folder moves into it; dropping on a page nests it as a subpage
    const row = e.target.closest('.row');
    const dest = !row ? '' : row.dataset.type === 'folder' ? row.dataset.path : stripMd(row.dataset.path);
    const from = dragPath;
    dragPath = null;
    const fromBase = from.endsWith('.md') ? stripMd(from) : from;
    if (dirName(from) === dest || dest === from || dest === fromBase || dest.startsWith(`${fromBase}/`) || dest.startsWith(`${from}/`)) return;
    if (dest) S.expanded.add(dest);
    const np = await renamePath(from, joinPath(dest, baseName(from)));
    if (np) toast(`Moved to ${dest ? `“${baseName(dest)}”` : 'the top level'}`);
  });

  // resize
  const handle = $('#sb-resize');
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    const move = (ev) => { prefs.sidebar = Math.round(Math.min(440, Math.max(208, ev.clientX))); applyPrefs(); };
    const up = () => { document.body.classList.remove('resizing'); handle.removeEventListener('pointermove', move); savePrefs(); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
  });
  handle.addEventListener('dblclick', () => { prefs.sidebar = 264; applyPrefs(); savePrefs(); });

  $('#vault-switch').onclick = (e) => vaultMenu(e.currentTarget);
  $('#btn-search').onclick = () => openPalette();
  $('#btn-new').onclick = () => newNote('');
  $('#btn-home').onclick = () => showHome();
  $('#btn-add-root').onclick = (e) => showMenu([
    { label: 'New page', icon: 'file-plus', run: () => newNote('') },
    { label: 'New from template…', icon: 'template', run: () => openTemplatePicker({ mode: 'new' }) },
    { label: 'New folder', icon: 'folder-plus', run: () => newFolder('') },
  ], e.currentTarget);
  $('#btn-today').onclick = () => openToday();
  $('#btn-ask').onclick = () => toggleAskPanel();
  $('#btn-graph').onclick = () => showGraph();
  $('#btn-collapse').onclick = () => setCollapsed(true);
  $('#btn-expand').onclick = () => setCollapsed(false);
  $('#btn-theme').onclick = (e) => themeMenu(e.currentTarget);
}

function setCollapsed(v) {
  prefs.collapsed = v;
  applyPrefs();
  savePrefs();
}

function vaultMenu(anchor) {
  const others = S.boot.recent.filter((r) => r.path !== S.vault.path).slice(0, 4);
  showMenu([
    { custom: h(`<div class="menu-vault"><span class="vault-tile" style="--hue:${hue(S.vault.name)}">${esc(S.vault.name[0]?.toUpperCase())}</span><div><strong>${esc(S.vault.name)}</strong><span>${esc(S.vault.display)}</span></div></div>`) },
    'sep',
    ...(others.length ? [{ header: 'Switch vault' }, ...others.map((o) => ({ label: o.name, icon: 'book', run: () => switchVault(o.path) }))] : []),
    { label: 'Open another folder…', icon: 'folder-open', run: () => openFolderPicker() },
    { label: 'Create a new vault…', icon: 'plus', run: () => createVaultDialog() },
    'sep',
    { header: 'Team servers' },
    ...savedTeams().map((c) => ({ label: c.url.replace(/^https?:\/\//, ''), icon: 'library', run: () => openTeam(c) })),
    { label: 'Connect to a team server…', icon: 'library', run: () => openTeam(null) },
    { label: 'Copy vault path', icon: 'copy', run: () => copy(S.vault.display, 'Path copied') },
    { label: 'AI settings…', icon: 'sparkles', run: () => openAISettings() },
    'sep',
    { label: 'Close vault', icon: 'logout', run: closeVault },
  ], anchor, { className: 'wide' });
}

async function switchVault(path) {
  await flushSave();
  await chooseVault(path);
}

async function closeVault() {
  await flushSave();
  await api.closeVault();
  S.boot = await api.state();
  S.vault = null;
  history.replaceState(null, '', '#');
  document.title = 'Local Notes Extended';
  showWelcome();
}

function themeMenu(anchor) {
  const set = (theme) => { prefs.theme = theme; applyPrefs(); savePrefs(); };
  showMenu([
    { header: 'Appearance' },
    { label: 'System', icon: 'monitor', checked: prefs.theme === 'system', run: () => set('system') },
    { label: 'Light', icon: 'sun', checked: prefs.theme === 'light', run: () => set('light') },
    { label: 'Dark', icon: 'moon', checked: prefs.theme === 'dark', run: () => set('dark') },
  ], anchor);
}

// ================================================================== home
function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Good evening' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

function showHome() {
  if (S.current?.dirty) flushSave();
  S.current = null;
  history.replaceState(null, '', '#');
  hideGraph();
  $('#page').hidden = true;
  $('#home').hidden = false;
  $('#topbar').classList.add('on-home');
  updatePageChrome();
  markActive();
  renderHome();
  $('#scroller').scrollTop = 0;
}

function renderHome() {
  const recentOpened = S.recents.map((p) => S.notes.find((n) => n.path === p)).filter(Boolean).slice(0, 6);
  const recentEdited = [...S.notes].sort((a, b) => b.mtime - a.mtime).slice(0, 8);
  const folders = new Set(S.notes.map((n) => n.folder).filter(Boolean)).size;
  const card = (n) => `<button class="card" data-open="${esc(n.path)}" style="--hue:${hue(n.name)}">
      <span class="card-cover"></span>
      <span class="card-icon">${icon('page', 18)}</span>
      <span class="card-title">${esc(n.name)}</span>
      <span class="card-meta">${n.folder ? `${icon('folder', 12)}<span>${esc(n.folder.split('/').pop())}</span><i>·</i>` : ''}<span>${timeAgo(n.mtime)}</span></span>
    </button>`;
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('#home').innerHTML = `
    <div class="home-inner">
      <div class="home-date">${esc(date)}</div>
      <h1 class="home-title">${greeting()}</h1>
      <div class="home-stats"><span>${icon('book', 15)}${esc(S.vault.name)}</span><span>${S.notes.length} page${S.notes.length === 1 ? '' : 's'}</span><span>${folders} folder${folders === 1 ? '' : 's'}</span></div>
      <div class="home-actions">
        <button class="action" data-act="new"><span class="action-icon">${icon('file-plus', 18)}</span><span><strong>New page</strong><em>${modKey}+Alt+N</em></span></button>
        <button class="action" data-act="today"><span class="action-icon">${icon('calendar', 18)}</span><span><strong>Today’s note</strong><em>Daily journal</em></span></button>
        <button class="action" data-act="template"><span class="action-icon">${icon('template', 18)}</span><span><strong>From template</strong><em>Meetings, wikis…</em></span></button>
        <button class="action" data-act="graph"><span class="action-icon">${icon('graph', 18)}</span><span><strong>Graph view</strong><em>See connections</em></span></button>
      </div>
      ${recentOpened.length ? `<section class="home-sec"><h2>${icon('clock', 15)}Jump back in</h2><div class="cards">${recentOpened.map(card).join('')}</div></section>` : ''}
      ${recentEdited.length ? `<section class="home-sec"><h2>${icon('pencil', 15)}Recently edited</h2><div class="cards">${recentEdited.map(card).join('')}</div></section>`
        : `<div class="home-empty"><div class="home-empty-art">${icon('feather', 34, 1.3)}</div><h3>A blank canvas</h3><p>Create a page to get started. It’s saved as a plain markdown file in your folder.</p><button class="btn primary" data-act="new">${icon('plus', 16, 2)}<span>New page</span></button></div>`}
    </div>`;
}

// ================================================================== page
let saveTimer = null;
let outlineTimer = null;
let flushTitle = () => Promise.resolve();

function setStatus(kind) {
  const el = $('#save-status');
  el.dataset.state = kind;
  el.innerHTML = kind === 'saving' ? '<span class="dot"></span>Saving…'
    : kind === 'error' ? `${icon('error', 14)}Not saved`
      : kind === 'saved' ? `${icon('check', 14, 2.2)}Saved` : '';
}

function updatePageChrome() {
  const crumbs = $('#crumbs');
  const fav = $('#btn-fav');
  const more = $('#btn-more');
  if (!S.current) {
    crumbs.innerHTML = `<span class="crumb current">${icon('home', 15)}<span>Home</span></span>`;
    fav.hidden = more.hidden = true;
    setStatus('');
    $('#edited').textContent = '';
    return;
  }
  const parts = S.current.path.split('/');
  const title = stripMd(parts.pop());
  crumbs.innerHTML = [
    ...parts.map((p, i) => {
      const folder = parts.slice(0, i + 1).join('/');
      const page = S.notes.find((n) => n.path === `${folder}.md`);
      return page
        ? `<button class="crumb" data-open="${esc(page.path)}">${icon('book', 14)}<span>${esc(p)}</span></button><span class="crumb-sep">/</span>`
        : `<button class="crumb" data-folder="${esc(folder)}">${icon('folder', 14)}<span>${esc(p)}</span></button><span class="crumb-sep">/</span>`;
    }),
    `<span class="crumb current">${icon('page', 14)}<span>${esc(title || 'Untitled')}</span></span>`,
  ].join('');
  fav.hidden = more.hidden = false;
  const isFav = S.favorites.includes(S.current.path);
  fav.classList.toggle('on', isFav);
  fav.title = isFav ? 'Remove from Favorites' : 'Add to Favorites';
  $('#edited').textContent = S.current.mtime ? `Edited ${timeAgo(S.current.mtime)}` : '';
}

async function openNote(path, { fresh = false, replace = false } = {}) {
  await flushSave();
  let data;
  try {
    data = await api.note(path);
  } catch (e) {
    toast(e.message, { kind: 'error' });
    await refreshTree();
    return;
  }
  const sourceContent = data.content.replace(/^\uFEFF/, '');
  const { fm, yaml, body } = splitFrontmatter(sourceContent);
  S.current = { path: data.path, mtime: data.mtime, fm: fm.replace(/\r\n/g, '\n'), eol: sourceContent.includes('\r\n') ? '\r\n' : '\n', dirty: false };
  $('#home').hidden = true;
  hideGraph();
  $('#topbar').classList.remove('on-home');
  const page = $('#page');
  page.hidden = false;
  page.classList.remove('enter');
  void page.offsetWidth;
  page.classList.add('enter');
  $('#title').textContent = stripMd(baseName(data.path));
  renderProps(yaml);
  sniffStyle(body);
  loadMarkdown(editor, body.replace(/\r\n/g, '\n'));
  updatePageChrome();
  setStatus('');
  updateCounts();
  history[replace ? 'replaceState' : 'pushState'](null, '', `#/${encodeURIComponent(data.path)}`);
  S.recents = [data.path, ...S.recents.filter((p) => p !== data.path)].slice(0, 12);
  persistVault();
  revealInTree(data.path);
  $('#scroller').scrollTop = 0;
  buildOutline();
  renderPageLinks(data.path);
  if (fresh) {
    const t = $('#title');
    t.focus();
    getSelection().selectAllChildren(t);
  }
}

function composeFile() {
  let md = getMarkdown(editor).replace(/\s+$/, '');
  md = md ? `${md}\n` : '';
  let out = S.current.fm ? (S.current.fm.endsWith('\n') ? S.current.fm : `${S.current.fm}\n`) + md : md;
  if (S.current.eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  return out;
}

function scheduleSave() {
  if (!S.current) return;
  S.current.dirty = true;
  setStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 650);
}

function save() {
  clearTimeout(saveTimer);
  const cur = S.current;
  if (!cur?.dirty) return opQueue;
  cur.dirty = false;
  const content = composeFile();
  return enqueue(async () => {
    try {
      const r = await api.save(cur.path, content);
      cur.mtime = r.mtime;
      const n = S.notes.find((x) => x.path === cur.path);
      if (n) n.mtime = r.mtime;
      if (S.current === cur) { setStatus(cur.dirty ? 'saving' : 'saved'); $('#edited').textContent = `Edited ${timeAgo(cur.mtime)}`; }
    } catch (e) {
      cur.dirty = true;
      setStatus('error');
      toast(`Couldn’t save: ${e.message}`, { kind: 'error' });
    }
  });
}

const flushSave = () => (S.current?.dirty ? save() : opQueue);

function updateCounts() {
  const text = editor.state.doc.textContent;
  const words = (text.match(/\S+/g) || []).length;
  S.current && (S.current.words = words);
}

// title → filename
let renameTimer = null;
function wireTitle() {
  const t = $('#title');
  let inflight = null;
  const commit = () => {
    clearTimeout(renameTimer);
    // Enter and the following blur both commit; chain them so the rename runs once.
    inflight = (inflight || Promise.resolve()).then(doCommit).finally(() => { inflight = null; });
    return inflight;
  };
  flushTitle = commit;
  const doCommit = async () => {
    if (!S.current) return;
    const raw = t.textContent.replace(/\s+/g, ' ').trim();
    const name = raw.replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || 'Untitled';
    const oldName = stripMd(baseName(S.current.path));
    if (name === oldName) return;
    const target = joinPath(dirName(S.current.path), `${name}.md`);
    if (S.notes.some((n) => n.path.toLowerCase() === target.toLowerCase() && n.path !== S.current.path)) {
      toast(`A page named “${name}” already exists here`, { kind: 'error' });
      return;
    }
    await renamePath(S.current.path, target);
  };
  t.addEventListener('input', () => {
    if (!S.current) return;
    const parts = $('#crumbs .crumb.current span');
    if (parts) parts.textContent = t.textContent.trim() || 'Untitled';
    const row = document.querySelector(`#tree .row[data-path="${CSS.escape(S.current.path)}"] .row-label`);
    if (row) row.textContent = t.textContent.trim() || 'Untitled';
    clearTimeout(renameTimer);
    renameTimer = setTimeout(commit, 1400);
  });
  t.addEventListener('blur', commit);
  t.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
      e.preventDefault();
      commit();
      if (e.key === 'Enter' && editor.state.doc.firstChild?.textContent) {
        editor.commands.insertContentAt(0, { type: 'paragraph' });
      }
      // focus synchronously (tiptap's focus() waits a frame, which can drop fast keystrokes)
      editor.view.focus();
      editor.view.dispatch(editor.state.tr.setSelection(Selection.atStart(editor.state.doc)).scrollIntoView());
    }
  });
  t.addEventListener('paste', (e) => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\n+/g, ' '));
  });
}

async function exportPage(format) {
  if (!S.current) return;
  const path = S.current.path;
  const labels = { docx: 'Word document', pdf: 'PDF', txt: 'plain text', html: 'HTML', md: 'Markdown' };
  try {
    toast(`Preparing ${labels[format] || format.toUpperCase()}…`, { timeout: 1600 });
    const { blob, filename } = await api.exportNote(path, format);
    downloadBlob(blob, filename);
    toast(`Exported ${filename}`, { kind: 'success' });
  } catch (e) {
    toast(`Couldn’t export: ${e.message}`, { kind: 'error' });
  }
}

function exportMenu(anchor) {
  if (!S.current) return;
  const item = (format, label, hint) => ({ label, hint, icon: 'download', run: () => exportPage(format) });
  showMenu([
    { header: 'Export note' },
    item('docx', 'Word document', '.docx'),
    item('pdf', 'PDF', '.pdf'),
    item('html', 'Web page', '.html'),
    item('txt', 'Plain text', '.txt'),
    item('md', 'Markdown', '.md'),
    { footer: 'Headings, lists, tables, code and local images are kept where the format supports them.' },
  ], anchor, { align: 'end', className: 'page-menu export-menu' });
}

function pageMenu(anchor) {
  if (!S.current) return;
  updateCounts();
  const fonts = h(`<div class="font-picker">
      ${[['sans', 'Default', 'Ag'], ['serif', 'Serif', 'Ag'], ['mono', 'Mono', 'Ag']].map(([k, label, s]) => `
        <button class="font-opt ${prefs.font === k ? 'on' : ''}" data-font="${k}"><span class="font-sample f-${k}">${s}</span><span>${label}</span></button>`).join('')}
    </div>`);
  fonts.addEventListener('click', (e) => {
    const b = e.target.closest('[data-font]');
    if (!b) return;
    prefs.font = b.dataset.font;
    applyPrefs();
    savePrefs();
    fonts.querySelectorAll('.font-opt').forEach((x) => x.classList.toggle('on', x === b));
  });
  const toggle = (key, label, ic) => {
    const row = h(`<button class="menu-item"><span class="mi-icon">${icon(ic, 16)}</span><span class="mi-label">${label}</span><span class="switch ${prefs[key] ? 'on' : ''}"><i></i></span></button>`);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      prefs[key] = !prefs[key];
      applyPrefs();
      savePrefs();
      $('.switch', row).classList.toggle('on', prefs[key]);
    });
    return { custom: row };
  };
  const path = S.current.path;
  showMenu([
    { header: 'Style' },
    { custom: fonts },
    toggle('small', 'Small text', 'text'),
    toggle('wide', 'Full width', 'arrow-up-right'),
    'sep',
    { label: 'Summarize with AI', icon: 'sparkles', run: () => summarizePage(editor, 'summary') },
    { label: 'Find action items with AI', icon: 'todo', run: () => summarizePage(editor, 'actions') },
    'sep',
    { label: S.favorites.includes(path) ? 'Remove from Favorites' : 'Add to Favorites', icon: 'star', run: () => toggleFavorite(path) },
    { label: 'Copy link to page', icon: 'page-link', run: () => copy(`[[${stripMd(baseName(path))}]]`, 'Wikilink copied') },
    { label: 'Copy file path', icon: 'copy', run: () => copy(`${S.vault.display}${S.vault.display.includes('\\') ? '\\' : '/'}${S.vault.display.includes('\\') ? path.replace(/\//g, '\\') : path}`, 'Path copied') },
    { label: 'Copy as markdown', icon: 'code', run: () => copy(composeFile(), 'Markdown copied') },
    { label: 'Export…', icon: 'download', run: () => exportMenu(anchor) },
    ...(window.desktop ? [{ label: isMacOS ? 'Reveal in Finder' : 'Show in folder', icon: 'folder-open', run: () => window.desktop.reveal(fullPathOf(path)) }] : []),
    'sep',
    { label: 'Delete', icon: 'trash', danger: true, run: () => deleteItem(path, false) },
    { footer: `Word count: ${S.current.words.toLocaleString()}<br>Last edited ${timeAgo(S.current.mtime)}` },
  ], anchor, { align: 'end', className: 'page-menu' });
}

// ================================================================== bubble menu & block handle
function buildBubble() {
  const el = h(`<div class="bubble pop">
    <button class="bb-ai" data-cmd="ai" title="Ask AI (${modKey}+J)">${icon('sparkles', 15)}<span class="bb-text">Ask AI</span></button>
    <span class="bb-sep"></span>
    <button class="bb-turn" data-cmd="turn"><span class="bb-turn-label">Text</span>${icon('chevron-down', 13, 2)}</button>
    <span class="bb-sep"></span>
    ${formatButtons(modKey)}
    <span class="bb-sep"></span>
    <button data-cmd="link" title="Link">${icon('link', 16, 2)}<span class="bb-text">Link</span></button>
    <form class="bb-link" hidden><input placeholder="Paste a link or page name…" spellcheck="false"><button type="button" data-cmd="unlink" title="Remove link">${icon('unlink', 15)}</button></form>
  </div>`);
  el.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
  const linkForm = $('.bb-link', el);
  const input = $('input', linkForm);
  const showLink = (on) => {
    linkForm.hidden = !on;
    el.classList.toggle('linking', on);
    if (on) { input.value = editor.getAttributes('link').href || ''; setTimeout(() => input.focus(), 0); }
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (!b) return;
    const c = editor.chain().focus();
    if (runFormat(editor, b.dataset.cmd, b)) { syncBubble(); return; }
    switch (b.dataset.cmd) {
      case 'link': showLink(true); break;
      case 'unlink': c.extendMarkRange('link').unsetLink().run(); showLink(false); break;
      case 'turn': turnIntoMenu(b); break;
      case 'ai': openAIMenu(editor, b); break;
      default:
    }
    syncBubble();
  });
  linkForm.addEventListener('submit', (e) => {
    e.preventDefault();
    let href = input.value.trim();
    const c = editor.chain().focus().extendMarkRange('link');
    if (!href) c.unsetLink().run();
    else {
      if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(href)) href = `https://${href}`;
      else if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#')) {
        const p = resolveNote(href);
        if (p) href = encodeURI(p);
      }
      c.setLink({ href }).run();
    }
    showLink(false);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); showLink(false); editor.commands.focus(); } });
  el.__reset = () => showLink(false);
  return el;
}

const TURN = [
  ['Text', 'text', (c) => c.setParagraph(), (e) => e.isActive('paragraph') && !e.isActive('bulletList') && !e.isActive('orderedList') && !e.isActive('taskList') && !e.isActive('blockquote')],
  ['Heading 1', 'h1', (c) => c.setHeading({ level: 1 }), (e) => e.isActive('heading', { level: 1 })],
  ['Heading 2', 'h2', (c) => c.setHeading({ level: 2 }), (e) => e.isActive('heading', { level: 2 })],
  ['Heading 3', 'h3', (c) => c.setHeading({ level: 3 }), (e) => e.isActive('heading', { level: 3 })],
  ['Bulleted list', 'bullet', (c) => c.toggleBulletList(), (e) => e.isActive('bulletList')],
  ['Numbered list', 'numbered', (c) => c.toggleOrderedList(), (e) => e.isActive('orderedList')],
  ['To-do list', 'todo', (c) => c.toggleTaskList(), (e) => e.isActive('taskList')],
  ['Quote', 'quote', (c) => c.toggleBlockquote(), (e) => e.isActive('blockquote')],
  ['Code', 'code', (c) => c.toggleCodeBlock(), (e) => e.isActive('codeBlock')],
];

function turnIntoMenu(anchor) {
  showMenu([{ header: 'Turn into' }, ...TURN.map(([label, ic, run, active]) => ({
    label, icon: ic, checked: active(editor), run: () => run(editor.chain().focus()).run(),
  }))], anchor, { className: 'turn-menu' });
}

function syncBubble() {
  const el = $('.bubble');
  if (!el) return;
  syncFormat(editor, el);
  el.querySelector('[data-cmd="link"]')?.classList.toggle('on', editor.isActive('link'));
  const cur = TURN.slice(1).find(([, , , active]) => active(editor));
  $('.bb-turn-label', el).textContent = cur ? cur[0] : 'Text';
}

function buildBlockHandle() {
  const el = h(`<div id="block-handle" class="hide">
      <button class="bh-add" title="Click to add a block below">${icon('plus', 17, 1.8)}</button>
      <span class="bh-grip" title="Drag to move">${icon('grip', 17, 1.8)}</span>
    </div>`);
  document.body.append(el);
  const add = $('.bh-add', el);
  add.addEventListener('mousedown', (e) => e.preventDefault());
  add.addEventListener('click', () => {
    const r = el.getBoundingClientRect();
    const hit = editor.view.posAtCoords({ left: r.right + 40, top: r.top + 12 });
    if (!hit) return;
    const $pos = editor.state.doc.resolve(hit.pos);
    const depth = Math.min(1, $pos.depth);
    if (depth < 1) return;
    const block = $pos.node(1);
    if (block.type.name === 'paragraph' && !block.textContent) {
      editor.chain().focus().setTextSelection($pos.start(1)).insertContent('/').run();
      return;
    }
    const after = $pos.after(1);
    editor.chain().insertContentAt(after, { type: 'paragraph' }).setTextSelection(after + 1).insertContent('/').focus().run();
  });
  return el;
}

// ================================================================== subpages, backlinks & outline
const wikiToHtml = (s) => esc(s)
  .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '<span class="bl-link">$2</span>')
  .replace(/!?\[\[([^\]]+)\]\]/g, '<span class="bl-link">$1</span>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/==([^=]+)==/g, '<mark>$1</mark>');

async function renderPageLinks(path) {
  const el = $('#page-links');
  el.innerHTML = '';
  const folder = stripMd(path);
  const subs = S.notes.filter((n) => dirName(n.path) === folder).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  let data = { linked: [], unlinked: [] };
  try { data = await api.links(path); } catch { /* index unavailable */ }
  if (S.current?.path !== path) return;
  const mention = (m) => `<button class="bl-item" data-open="${esc(m.path)}">
      <span class="bl-title">${icon('page', 15)}<span>${esc(m.title)}</span>${dirName(m.path) ? `<em>${esc(dirName(m.path))}</em>` : ''}</span>
      ${m.snippets.map((s) => `<span class="bl-snippet">${wikiToHtml(s)}</span>`).join('')}
    </button>`;
  el.innerHTML = `
    ${subs.length ? `<section class="pl-sec">
      <h3>${icon('book', 15)}Subpages<span class="pl-count">${subs.length}</span></h3>
      <div class="sub-grid">${subs.map((n) => `<button class="sub-card" data-open="${esc(n.path)}">${icon('page', 16)}<span>${esc(n.name)}</span></button>`).join('')}
        <button class="sub-card add" data-subpage>${icon('plus', 16)}<span>Add subpage</span></button></div>
    </section>` : ''}
    <section class="pl-sec">
      <h3>${icon('page-link', 15)}Linked mentions<span class="pl-count">${data.linked.length}</span></h3>
      ${data.linked.length ? `<div class="bl-list">${data.linked.map(mention).join('')}</div>`
        : `<p class="bl-empty">No other pages link here yet. Type <kbd>[[</kbd> in any page to link to “${esc(stripMd(baseName(path)))}”.</p>`}
    </section>
    ${data.unlinked.length ? `<details class="pl-sec">
      <summary><h3>${icon('chevron-right', 14, 2)}Unlinked mentions<span class="pl-count">${data.unlinked.length}</span></h3></summary>
      <div class="bl-list">${data.unlinked.map(mention).join('')}</div>
    </details>` : ''}`;
}

let outlineHeads = [];
function buildOutline() {
  const el = $('#outline');
  outlineHeads = [];
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === 'heading' && node.textContent.trim()) outlineHeads.push({ level: node.attrs.level, text: node.textContent, pos: offset });
  });
  if (outlineHeads.length < 3 || $('#page').hidden) { el.hidden = true; return; }
  const min = Math.min(...outlineHeads.map((x) => x.level));
  el.hidden = false;
  el.innerHTML = `<div class="ol-rail">${outlineHeads.map((x) => `<i style="--l:${x.level - min}"></i>`).join('')}</div>
    <div class="ol-card"><div class="ol-head">On this page</div>${outlineHeads.map((x, i) => `<button data-i="${i}" style="--l:${x.level - min}">${esc(x.text)}</button>`).join('')}</div>`;
  syncOutline();
}

function syncOutline() {
  const el = $('#outline');
  if (el.hidden || !outlineHeads.length) return;
  const top = $('#scroller').getBoundingClientRect().top + 90;
  let active = 0;
  outlineHeads.forEach((x, i) => {
    const dom = editor.view.nodeDOM(x.pos);
    if (dom?.getBoundingClientRect && dom.getBoundingClientRect().top <= top) active = i;
  });
  el.querySelectorAll('.ol-rail i, .ol-card button').forEach((b) => b.classList.remove('on'));
  el.querySelectorAll(`.ol-rail i:nth-child(${active + 1}), .ol-card button[data-i="${active}"]`).forEach((b) => b.classList.add('on'));
}

// ================================================================== graph view
let graph = null;
async function showGraph(focus = null) {
  await flushSave();
  let data;
  try { data = await api.graph(); } catch (e) { toast(e.message, { kind: 'error' }); return; }
  const from = focus || S.current?.path || null;
  if (graph) { graph.destroy(); graph = null; }
  S.current = null;
  $('#page').hidden = true;
  $('#home').hidden = true;
  $('#outline').hidden = true;
  $('#topbar').classList.add('on-home');
  updatePageChrome();
  markActive();
  const title = focus ? `Local graph · ${stripMd(baseName(focus))}` : 'Graph view';
  $('#crumbs').innerHTML = `<span class="crumb current">${icon('graph', 15)}<span>${esc(title)}</span></span>`;
  history.replaceState(null, '', '#graph');
  const gv = $('#graph-view');
  gv.hidden = false;
  const folders = [...new Set(data.nodes.filter((n) => !n.unresolved).map((n) => n.folder))].sort();
  setFolders(folders);
  gv.innerHTML = `
    <canvas class="gv-canvas"></canvas>
    <div class="gv-panel pop">
      <div class="gv-search">${icon('search', 15)}<input placeholder="Filter pages…" spellcheck="false"></div>
      <label class="gv-toggle"><span>Orphans</span><input type="checkbox" data-f="orphans" checked><span class="switch on"><i></i></span></label>
      <label class="gv-toggle"><span>Unlinked pages</span><input type="checkbox" data-f="unresolved" checked><span class="switch on"><i></i></span></label>
      ${focus ? `<button class="btn ghost small gv-full">${icon('graph', 14)}<span>Show whole vault</span></button>` : ''}
      <div class="gv-stats"></div>
    </div>
    <div class="gv-legend">${folders.map((f) => `<span><i style="background:${folderColor(f, document.documentElement.dataset.theme === 'dark')}"></i>${esc(f || 'Top level')}</span>`).join('')}</div>
    <div class="gv-zoom">
      <button class="icon-btn" data-z="in" title="Zoom in">${icon('zoom-in', 17)}</button>
      <button class="icon-btn" data-z="out" title="Zoom out">${icon('zoom-out', 17)}</button>
      <button class="icon-btn" data-z="fit" title="Fit to screen">${icon('fit', 17)}</button>
    </div>
    ${data.nodes.length ? '' : `<div class="gv-empty">${icon('graph', 30, 1.4)}<span>No pages yet. Links between pages show up here.</span></div>`}`;
  graph = mountGraph($('.gv-canvas', gv), data, { current: from, focus, onOpen: (p) => openNote(p) });
  const s = graph.stats();
  $('.gv-stats', gv).textContent = `${s.nodes} pages · ${s.edges} links`;
  $('.gv-search input', gv).addEventListener('input', (e) => graph.setFilter({ query: e.target.value }));
  gv.querySelectorAll('[data-f]').forEach((cb) => cb.addEventListener('change', () => {
    cb.nextElementSibling.classList.toggle('on', cb.checked);
    graph.setFilter({ [cb.dataset.f]: cb.checked });
  }));
  gv.querySelector('.gv-full')?.addEventListener('click', () => showGraph());
  gv.querySelector('.gv-zoom').addEventListener('click', (e) => {
    const z = e.target.closest('[data-z]')?.dataset.z;
    if (z === 'in') graph.zoom(1.4); else if (z === 'out') graph.zoom(1 / 1.4); else if (z === 'fit') graph.fit();
  });
}

function hideGraph() {
  if (graph) { graph.destroy(); graph = null; }
  const gv = $('#graph-view');
  if (gv) { gv.hidden = true; gv.innerHTML = ''; }
}

// ================================================================== templates & daily notes
const pad = (n, w = 2) => String(n).padStart(w, '0');
function formatDate(d, fmt) {
  const months = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' }));
  const days = Array.from({ length: 7 }, (_, i) => new Date(2000, 0, 2 + i).toLocaleString(undefined, { weekday: 'long' }));
  const map = {
    YYYY: d.getFullYear(), YY: String(d.getFullYear()).slice(2), MMMM: months[d.getMonth()], MMM: months[d.getMonth()].slice(0, 3),
    MM: pad(d.getMonth() + 1), M: d.getMonth() + 1, DD: pad(d.getDate()), D: d.getDate(), dddd: days[d.getDay()], ddd: days[d.getDay()].slice(0, 3),
    HH: pad(d.getHours()), H: d.getHours(), hh: pad(d.getHours() % 12 || 12), h: d.getHours() % 12 || 12, mm: pad(d.getMinutes()), ss: pad(d.getSeconds()),
    A: d.getHours() < 12 ? 'AM' : 'PM', a: d.getHours() < 12 ? 'am' : 'pm',
  };
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A|a/g, (m, lit) => (lit !== undefined ? lit : map[m]));
}

function fillTemplate(text, title) {
  const now = new Date();
  return text
    .replace(/\{\{\s*title\s*\}\}/gi, title)
    .replace(/\{\{\s*date(?::([^}]+))?\s*\}\}/gi, (_, f) => formatDate(now, f?.trim() || 'YYYY-MM-DD'))
    .replace(/\{\{\s*time(?::([^}]+))?\s*\}\}/gi, (_, f) => formatDate(now, f?.trim() || 'HH:mm'));
}

async function openTemplatePicker({ mode = 'new' } = {}) {
  let info;
  try { info = await api.templates(); } catch (e) { toast(e.message, { kind: 'error' }); return; }
  const box = h(`<div class="tpl">
    <div class="tpl-head"><h2>${mode === 'new' ? 'New page from template' : 'Insert a template'}</h2>
      <p>Any page in the <code>${esc(info.folder)}</code> folder is a template. Use <code>{{title}}</code>, <code>{{date}}</code> and <code>{{time}}</code> in them.</p>
      <button class="icon-btn" data-close aria-label="Close">${icon('x', 18)}</button></div>
    <div class="tpl-body"></div>
  </div>`);
  const modal = openModal(box, { className: 'tpl-modal' });
  $('[data-close]', box).onclick = () => modal.close();
  const body = $('.tpl-body', box);

  const render = () => {
    if (!info.templates.length) {
      body.innerHTML = `<div class="tpl-empty"><div class="tpl-empty-art">${icon('template', 30, 1.4)}</div>
        <h3>No templates yet</h3><p>Start with four ready-made templates: meeting notes, project brief, daily note and wiki page. You can edit them like any other page.</p>
        <button class="btn primary" data-install>${icon('sparkles', 16)}<span>Add starter templates</span></button></div>`;
      $('[data-install]', body).onclick = async () => {
        await api.installTemplates();
        info = await api.templates();
        await refreshTree();
        render();
      };
      return;
    }
    body.innerHTML = `<div class="tpl-list">${info.templates.map((t, i) => `<button class="tpl-item" data-i="${i}"><span class="tpl-icon" style="--hue:${hue(t.name)}">${icon('template', 18)}</span><span>${esc(t.name)}</span></button>`).join('')}</div>
      <div class="tpl-preview"><div class="tpl-preview-inner"></div><button class="btn primary tpl-use">${icon('check', 16, 2)}<span>${mode === 'new' ? 'Create page' : 'Insert'}</span></button></div>`;
    let sel = 0;
    const cache = new Map();
    const select = async (i) => {
      sel = i;
      body.querySelectorAll('.tpl-item').forEach((b) => b.classList.toggle('active', +b.dataset.i === i));
      const t = info.templates[i];
      if (!cache.has(t.path)) cache.set(t.path, (await api.note(t.path)).content);
      const { body: md } = splitFrontmatter(cache.get(t.path));
      $('.tpl-preview-inner', body).innerHTML = `<div class="tpl-preview-title">${esc(t.name)}</div><pre>${esc(fillTemplate(md, t.name).trim().slice(0, 900))}</pre>`;
    };
    body.querySelector('.tpl-list').addEventListener('click', (e) => { const b = e.target.closest('.tpl-item'); if (b) select(+b.dataset.i); });
    body.querySelector('.tpl-list').addEventListener('dblclick', () => use());
    const use = async () => {
      const t = info.templates[sel];
      const raw = cache.get(t.path) ?? (await api.note(t.path)).content;
      modal.close();
      if (mode === 'new') {
        const name = /daily/i.test(t.name) ? formatDate(new Date(), 'YYYY-MM-DD') : t.name;
        const r = await api.create(S.current ? dirName(S.current.path) : '', name, fillTemplate(raw, name));
        await refreshTree();
        await openNote(r.path, { fresh: true });
      } else if (S.current) {
        const { fm, body: md } = splitFrontmatter(fillTemplate(raw, stripMd(baseName(S.current.path))));
        if (fm && !S.current.fm) { S.current.fm = fm.replace(/\r\n/g, '\n'); renderProps(splitFrontmatter(fm).yaml); }
        editor.chain().focus().insertContent(md).run();
        scheduleSave();
      }
    };
    $('.tpl-use', body).onclick = use;
    select(0);
  };
  render();
}
host.insertTemplate = () => openTemplatePicker({ mode: 'insert' });

async function openToday() {
  let s;
  try { s = await api.daily(); } catch (e) { toast(e.message, { kind: 'error' }); return; }
  const rel = formatDate(new Date(), s.format || 'YYYY-MM-DD');
  const full = joinPath(s.folder, rel);
  const existing = S.notes.find((n) => stripMd(n.path).toLowerCase() === full.toLowerCase());
  if (existing) return openNote(existing.path);
  let content = '';
  if (s.template) {
    try { content = (await api.note(s.template.replace(/\.md$/i, '') + '.md')).content; } catch { /* missing template */ }
  }
  if (!content) content = '## Focus\n\n- [ ] Most important thing today\n\n## Notes\n';
  const r = await api.create(dirName(full), baseName(full), fillTemplate(content, baseName(full)));
  await refreshTree();
  await openNote(r.path);
  editor.commands.focus('end');
}

// ================================================================== command palette
function openPalette(initial = '') {
  const box = h(`<div class="palette">
    <div class="pl-input">${icon('search', 18)}<input placeholder="Search pages and content in ${esc(S.vault.name)}…" spellcheck="false"><kbd>esc</kbd></div>
    <div class="pl-results" role="listbox"></div>
    <div class="pl-foot"><span><kbd>↑</kbd><kbd>↓</kbd>Navigate</span><span><kbd>↵</kbd>Open</span><span><kbd>${modKey}</kbd><kbd>↵</kbd>Create page</span><span><kbd>&gt;</kbd>Commands</span></div>
  </div>`);
  const modal = openModal(box, { className: 'palette-modal' });
  const input = $('input', box);
  const results = $('.pl-results', box);
  let items = [];
  let index = 0;
  let seq = 0;

  const mark = (text, q) => {
    if (!q) return esc(text);
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    return i < 0 ? esc(text) : `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
  };

  const COMMANDS = [
    ['New page', 'file-plus', () => newNote('')],
    ['New page from template', 'template', () => openTemplatePicker({ mode: 'new' })],
    ['Open today’s note', 'calendar', () => openToday()],
    ['Open graph view', 'graph', () => showGraph()],
    ['Ask AI about your notes', 'sparkles', () => toggleAskPanel()],
    ['Summarize this page with AI', 'sparkles', () => S.current && summarizePage(editor, 'summary')],
    ['AI settings', 'sparkles', () => openAISettings()],
    ['New folder', 'folder-plus', () => newFolder('')],
    ['Go home', 'home', () => showHome()],
    ['Switch to dark theme', 'moon', () => { prefs.theme = 'dark'; applyPrefs(); savePrefs(); }],
    ['Switch to light theme', 'sun', () => { prefs.theme = 'light'; applyPrefs(); savePrefs(); }],
    ['Open another vault…', 'folder-open', () => openFolderPicker()],
  ];
  const render = (q, content = []) => {
    const cmdQ = q.replace(/^>\s*/, '').toLowerCase();
    const cmds = q.startsWith('>') ? COMMANDS.filter(([l]) => l.toLowerCase().includes(cmdQ))
      : q.trim().length > 1 ? COMMANDS.filter(([l]) => l.toLowerCase().includes(cmdQ)).slice(0, 3) : [];
    const names = q.startsWith('>') ? [] : fuzzyNotes(q, q ? 12 : 8);
    const seen = new Set(names.map((n) => n.path));
    const extra = content.filter((c) => !seen.has(c.path) || c.snippet);
    items = [];
    let html = '';
    if (names.length) {
      html += `<div class="pl-group">${q ? 'Pages' : 'Recent'}</div>`;
      names.forEach((n) => {
        const snippet = content.find((c) => c.path === n.path)?.snippet;
        items.push({ open: n.path });
        html += `<button class="pl-item" data-i="${items.length - 1}"><span class="pl-icon">${icon('page', 17)}</span><span class="pl-body"><span class="pl-title">${mark(n.name, q)}</span>${snippet ? `<span class="pl-snippet">${mark(snippet, q)}</span>` : ''}</span><span class="pl-folder">${esc(n.folder)}</span><span class="pl-time">${timeAgo(n.mtime)}</span></button>`;
      });
    }
    if (cmds.length) {
      html += '<div class="pl-group">Commands</div>';
      cmds.forEach(([label, ic, fn]) => {
        items.push({ cmd: fn });
        html += `<button class="pl-item" data-i="${items.length - 1}"><span class="pl-icon cmd">${icon(ic, 17)}</span><span class="pl-body"><span class="pl-title">${mark(label, cmdQ)}</span></span></button>`;
      });
    }
    const contentOnly = extra.filter((c) => !seen.has(c.path));
    if (contentOnly.length) {
      html += '<div class="pl-group">Mentions in content</div>';
      contentOnly.slice(0, 12).forEach((c) => {
        items.push({ open: c.path });
        html += `<button class="pl-item" data-i="${items.length - 1}"><span class="pl-icon">${icon('text', 17)}</span><span class="pl-body"><span class="pl-title">${esc(c.title)}</span><span class="pl-snippet">${mark(c.snippet, q)}</span></span><span class="pl-folder">${esc(dirName(c.path))}</span></button>`;
      });
    }
    if (q.trim() && !q.startsWith('>')) {
      items.push({ create: q.trim() });
      html += `<div class="pl-group">Create</div><button class="pl-item" data-i="${items.length - 1}"><span class="pl-icon add">${icon('plus', 17)}</span><span class="pl-body"><span class="pl-title">New page “${esc(q.trim())}”</span></span></button>`;
    }
    if (!items.length) html = `<div class="pl-empty">${icon('search', 26, 1.4)}<span>Type to search across your vault</span></div>`;
    results.innerHTML = html;
    index = Math.min(index, Math.max(0, items.length - 1));
    highlight();
  };
  const highlight = () => {
    results.querySelectorAll('.pl-item').forEach((b) => b.classList.toggle('active', +b.dataset.i === index));
    results.querySelector('.pl-item.active')?.scrollIntoView({ block: 'nearest' });
  };
  const run = async (it) => {
    if (!it) return;
    modal.close();
    if (it.open) openNote(it.open);
    else if (it.cmd) it.cmd();
    else if (it.create) {
      const r = await api.create('', it.create);
      await refreshTree();
      openNote(r.path);
    }
  };

  let timer;
  input.addEventListener('input', () => {
    const q = input.value;
    index = 0;
    render(q);
    clearTimeout(timer);
    if (q.trim().length < 2) return;
    const my = ++seq;
    timer = setTimeout(async () => {
      try {
        const { results: r } = await api.search(q);
        if (my === seq) render(q, r);
      } catch { /* keep filename results */ }
    }, 160);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); index = (index + 1) % Math.max(1, items.length); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); index = (index - 1 + items.length) % Math.max(1, items.length); highlight(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && input.value.trim()) run({ create: input.value.trim() });
      else run(items[index]);
    }
  });
  results.addEventListener('click', (e) => { const b = e.target.closest('.pl-item'); if (b) run(items[+b.dataset.i]); });
  results.addEventListener('mousemove', (e) => { const b = e.target.closest('.pl-item'); if (b && +b.dataset.i !== index) { index = +b.dataset.i; highlight(); } });
  input.value = initial;
  render(initial);
  input.focus();
}

// ================================================================== external changes
let lastCheck = 0;
async function checkExternal() {
  if (!S.vault || Date.now() - lastCheck < 1500) return;
  lastCheck = Date.now();
  try {
    await refreshTree();
    if (S.current && !S.current.dirty) {
      const st = await api.stat(S.current.path);
      if (!st.exists) { toast('This page was moved or deleted outside Local Notes Extended'); showHome(); return; }
      if (st.mtime > S.current.mtime + 0.001) {
        const scroll = $('#scroller').scrollTop;
        const sel = editor.state.selection;
        const data = await api.note(S.current.path);
        const { fm, yaml, body } = splitFrontmatter(data.content.replace(/^\uFEFF/, ''));
        Object.assign(S.current, { mtime: data.mtime, fm: fm.replace(/\r\n/g, '\n') });
        renderProps(yaml);
        loadMarkdown(editor, body.replace(/\r\n/g, '\n'));
        try { editor.commands.setTextSelection(Math.min(sel.from, editor.state.doc.content.size)); } catch { /* ignore */ }
        $('#scroller').scrollTop = scroll;
        updatePageChrome();
        toast('Updated with changes from disk');
      }
    }
  } catch { /* vault may be offline */ }
}

// ================================================================== shell
function buildShell() {
  const shell = $('#shell');
  shell.innerHTML = `
    <aside class="sidebar" id="sidebar">
      <div class="sb-top">
        <button class="vault-switch" id="vault-switch">
          <span class="vault-tile" id="vault-tile"></span>
          <span class="vault-label" id="vault-name"></span>
          <span class="vs-chev">${icon('chevron-down', 14, 2)}</span>
        </button>
        <button class="icon-btn sb-collapse" id="btn-collapse" title="Close sidebar (${modKey}+\\)">${icon('sidebar-close', 17)}</button>
      </div>
      <nav class="sb-nav">
        <button class="nav-item" id="btn-search">${icon('search', 17)}<span>Search</span><kbd>${modKey} K</kbd></button>
        <button class="nav-item ai-nav" id="btn-ask">${icon('sparkles', 17)}<span>Ask AI</span><kbd>${modKey} J</kbd></button>
        <button class="nav-item" id="btn-home">${icon('home', 17)}<span>Home</span></button>
        <button class="nav-item" id="btn-today">${icon('calendar', 17)}<span>Today</span></button>
        <button class="nav-item" id="btn-graph">${icon('graph', 17)}<span>Graph view</span><kbd>${modKey} G</kbd></button>
        <button class="nav-item" id="btn-new">${icon('file-plus', 17)}<span>New page</span><kbd>${modKey} Alt N</kbd></button>
      </nav>
      <div class="sb-scroll">
        <section id="fav-section" hidden>
          <div class="sb-label"><span>Favorites</span></div>
          <div id="favorites"></div>
        </section>
        <section>
          <div class="sb-label"><span>Pages</span><span class="count" id="page-count"></span><button class="icon-btn tiny" id="btn-add-root" title="Add a page or folder">${icon('plus', 15)}</button></div>
          <div id="tree" class="tree"></div>
        </section>
      </div>
      <div class="sb-foot">
        <button class="nav-item" id="btn-theme">${icon('sun', 17)}<span>Appearance</span></button>
      </div>
      <div class="sb-resize" id="sb-resize" title="Drag to resize"></div>
    </aside>
    <div class="sb-scrim" id="sb-scrim" hidden></div>
    <main class="main">
      <header class="topbar" id="topbar">
        <button class="icon-btn sb-expand" id="btn-expand" title="Open sidebar (${modKey}+\\)">${icon('sidebar-open', 18)}</button>
        <button class="icon-btn mobile-search" id="btn-mobile-search" title="Search">${icon('search', 18)}</button>
        <nav class="crumbs" id="crumbs"></nav>
        <div class="tb-right">
          <span class="save-status" id="save-status"></span>
          <span class="edited" id="edited"></span>
          <button class="icon-btn" id="btn-fav" title="Add to Favorites" hidden>${icon('star', 18)}</button>
          <button class="icon-btn" id="btn-more" title="Page options" hidden>${icon('more', 18)}</button>
        </div>
      </header>
      <div class="scroller" id="scroller">
        <div class="home" id="home" hidden></div>
        <article class="page" id="page" hidden>
          <div class="page-inner">
            <h1 class="title" id="title" contenteditable="plaintext-only" spellcheck="false" data-placeholder="Untitled"></h1>
            <div class="props" id="props" hidden></div>
            <div id="editor"></div>
            <div class="page-tail" id="page-tail"></div>
            <div class="page-links" id="page-links"></div>
          </div>
        </article>
      </div>
      <nav class="outline" id="outline" hidden></nav>
      <div class="graph-view" id="graph-view" hidden></div>
    </main>`;

  const bubble = buildBubble();
  buildBlockHandle();
  editor = createEditor({
    element: $('#editor'),
    bubble,
    onUpdate: () => { scheduleSave(); clearTimeout(outlineTimer); outlineTimer = setTimeout(buildOutline, 500); },
  });
  $('#outline').addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    const head = b && outlineHeads[+b.dataset.i];
    const dom = head && editor.view.nodeDOM(head.pos);
    if (!dom) return;
    const sc = $('#scroller');
    sc.scrollTo({ top: sc.scrollTop + dom.getBoundingClientRect().top - sc.getBoundingClientRect().top - 70, behavior: 'smooth' });
  });
  $('#page-links').addEventListener('click', (e) => {
    if (e.target.closest('[data-subpage]') && S.current) return addSubpage(S.current.path);
    const t = e.target.closest('[data-open]');
    if (t) openNote(t.dataset.open);
  });
  editor.on('selectionUpdate', () => { syncBubble(); });
  editor.on('blur', () => bubble.__reset());
  $('#scroller').addEventListener('scroll', (e) => {
    $('#block-handle').classList.add('hide');
    $('#topbar').classList.toggle('scrolled', e.target.scrollTop > 4);
    syncOutline();
  }, { passive: true });
  // clicking the empty space under a page focuses the end of the doc, like Notion
  $('#page-tail').addEventListener('mousedown', (e) => {
    e.preventDefault();
    const last = editor.state.doc.lastChild;
    if (last && !(last.type.name === 'paragraph' && !last.textContent)) {
      editor.chain().insertContentAt(editor.state.doc.content.size, { type: 'paragraph' }).focus('end').run();
    } else editor.commands.focus('end');
  });

  $('#btn-fav').onclick = () => S.current && toggleFavorite(S.current.path);
  $('#btn-more').onclick = (e) => pageMenu(e.currentTarget);
  $('#btn-mobile-search').onclick = () => openPalette();
  const mobile = matchMedia('(max-width: 640px)');
  if (mobile.matches) document.body.classList.add('sidebar-collapsed');
  const scrim = $('#sb-scrim');
  const syncScrim = () => {
    if (!scrim) return;
    scrim.hidden = document.body.classList.contains('sidebar-collapsed') || !mobile.matches;
  };
  scrim.onclick = () => { document.body.classList.add('sidebar-collapsed'); syncScrim(); };
  $('#btn-expand').addEventListener('click', () => setTimeout(syncScrim, 0));
  $('#btn-collapse').addEventListener('click', () => setTimeout(syncScrim, 0));
  mobile.addEventListener?.('change', () => {
    if (mobile.matches) document.body.classList.add('sidebar-collapsed');
    syncScrim();
  });
  syncScrim();
  $('#crumbs').addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o) return openNote(o.dataset.open);
    const c = e.target.closest('[data-folder]');
    if (!c) return;
    revealInTree(`${c.dataset.folder}/x`);
    const row = document.querySelector(`#tree .row[data-path="${CSS.escape(c.dataset.folder)}"]`);
    row?.scrollIntoView({ block: 'center' });
    row?.classList.add('flash');
    setTimeout(() => row?.classList.remove('flash'), 900);
  });
  $('#home').addEventListener('click', (e) => {
    const card = e.target.closest('[data-open]');
    if (card) return openNote(card.dataset.open);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'new') newNote('');
    if (act === 'search') openPalette();
    if (act === 'folder') newFolder('');
    if (act === 'today') openToday();
    if (act === 'template') openTemplatePicker({ mode: 'new' });
    if (act === 'graph') showGraph();
  });
  wireSidebar();
  wireTitle();
}

function wireGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!S.vault || $('#shell').hidden) return;
    const k = e.key.toLowerCase();
    if (mod && (k === 'k' || k === 'p') && !e.shiftKey) {
      if (k === 'k' && editor.isFocused && !editor.state.selection.empty) { e.preventDefault(); $('.bubble [data-cmd="link"]')?.click(); return; }
      e.preventDefault();
      if (!$('.palette')) openPalette();
    } else if (mod && e.altKey && k === 'n') { e.preventDefault(); newNote(S.current ? dirName(S.current.path) : ''); }
    else if (mod && k === 's') { e.preventDefault(); flushSave(); }
    else if (mod && k === 'g' && !e.shiftKey) { e.preventDefault(); showGraph(); }
    else if (mod && k === 'j') {
      e.preventDefault();
      if (editor.isFocused && !editor.state.selection.empty) openAIMenu(editor, $('.bubble [data-cmd="ai"]') || { x: innerWidth / 2, y: 120 });
      else if (editor.isFocused) openWritePanel(editor);
      else toggleAskPanel();
    }
    else if (mod && e.key === '\\') { e.preventDefault(); setCollapsed(!prefs.collapsed); }
  });
  window.addEventListener('focus', checkExternal);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkExternal(); });
  window.addEventListener('beforeunload', () => {
    if (S.current?.dirty) api.save(S.current.path, composeFile(), true);
  });
  window.addEventListener('popstate', () => {
    const p = decodeURIComponent(location.hash.slice(2));
    if (p && S.notes.some((n) => n.path === p)) { if (p !== S.current?.path) openNote(p, { replace: true }); }
    else if (S.current) showHome();
  });
  setInterval(() => { if (S.current?.mtime && !S.current.dirty) $('#edited').textContent = `Edited ${timeAgo(S.current.mtime)}`; }, 30000);
}

const isMacOS = window.desktop?.platform === 'darwin';
const fullPathOf = (rel) => {
  const sep = S.vault.path.includes('\\') ? '\\' : '/';
  return S.vault.path.replace(/[\\/]+$/, '') + sep + rel.split('/').join(sep);
};

function installAIHooks() {
  host.aiWrite = () => openWritePanel(editor);
  setAIHooks({
    openLink: (l) => host.openLink(l),
    vaultName: () => S.vault?.name || 'your notes',
    currentPage: () => (S.current ? { id: S.current.path, title: stripMd(baseName(S.current.path)) } : null),
  });
}

// ================================================================== teams
// From the desktop/local app: leave the local vault UI and open a team server.
async function openTeam(conn) {
  await flushSave();
  closeAskPanel();
  const back = () => {
    installAIHooks();
    if (S.vault) { $('#shell').hidden = false; $('#welcome').hidden = true; }
    else showWelcome();
  };
  if (conn?.token) await startTeam(conn, { onExit: back });
  else await showTeamSignIn({ url: conn?.url || '', onBack: back });
}

// When this UI is served by a team server, it *is* the team app.
async function startHosted() {
  document.body.classList.add('hosted');
  const invite = location.hash.match(/^#\/invite\/([\w-]+)/)?.[1] || null;
  const saved = savedTeams().find((c) => c.url === location.origin);
  if (saved?.token) {
    if (invite) {
      try {
        const r = await fetch(`/api/invites/${invite}/accept`, { method: 'POST', headers: { Authorization: `Bearer ${saved.token}` } });
        history.replaceState(null, '', '#');
        if (r.ok) toast('You joined the workspace', { kind: 'success' });
      } catch { /* fall through to the app */ }
    }
    await startTeam(saved, { hosted: true });
  } else {
    await showTeamSignIn({ hosted: true, invite });
  }
}

// Register the installable PWA shell on HTTPS or localhost. Capacitor builds
// use the same public/ directory, so the mobile wrapper needs no separate UI.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// ================================================================== offline PWA boot
function collectOfflinePages() {
  const pages = new Map();
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('ln:team:offline:')) continue;
      let list = [];
      try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch { list = []; }
      for (const p of list) if (p?.id && !pages.has(p.id)) pages.set(p.id, p);
    }
  } catch { /* storage unavailable */ }
  return [...pages.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function showOfflineBoot(pages) {
  const root = h(`<div class="offline-boot">
    <header><span class="offline-mark">${logo(30)}</span><div><strong>Local Notes Extended</strong><span>Offline library</span></div></header>
    <h1>Your recent pages, without a connection.</h1>
    <p>${pages.length} page${pages.length === 1 ? '' : 's'} saved on this device. Open one to read the last synced copy.</p>
    <label class="offline-search">${icon('search', 17)}<input placeholder="Search saved pages…" spellcheck="false"><kbd>esc</kbd></label>
    <div class="offline-results"></div>
    <footer><span>Stored locally by your team session.</span><button class="btn ghost small" data-retry>${icon('arrow-right', 15)}<span>Reconnect</span></button></footer>
  </div>`);
  document.body.innerHTML = '';
  document.body.append(root);
  document.body.classList.add('offline-mode', 'ready');
  const input = $('input', root);
  const results = $('.offline-results', root);
  const render = () => {
    const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    const found = pages.filter((p) => terms.every((t) => `${p.title}\n${p.markdown}`.toLowerCase().includes(t))).slice(0, 30);
    results.innerHTML = found.length ? found.map((p) => `<button class="offline-result" data-id="${esc(p.id)}">
      <span class="offline-result-ic">${icon('page', 17)}</span>
      <span><strong>${esc(p.title || 'Untitled')}</strong><em>${esc(String(p.markdown || '').replace(/[#>*_!\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 130))}</em></span>
      <span class="offline-time">${p.updatedAt ? timeAgo(p.updatedAt / 1000) : ''}</span>
    </button>`).join('') : `<div class="offline-empty">${icon('search', 24, 1.4)}<span>No saved page matches “${esc(input.value)}”.</span></div>`;
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') input.value = ''; render(); });
  results.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    const page = pages.find((p) => p.id === b.dataset.id);
    if (page) showOfflinePage(page);
  });
  $('[data-retry]', root).onclick = () => location.reload();
  render();
  setTimeout(() => input.focus(), 30);
}

// ================================================================== boot
async function boot() {
  if (window.desktop) {
    document.body.classList.add('desktop', `os-${window.desktop.platform}`);
    window.desktop.onUpdateReady(({ version }) => toast(`Local Notes Extended ${version} is ready`, {
      kind: 'update', timeout: 0, action: { label: 'Restart to update', run: () => window.desktop.installUpdate() },
    }));
  }
  applyPrefs();
  buildShell();
  installAIHooks();
  wireGlobalKeys();
  if (window.desktop?.onCloseRequest) {
    window.desktop.onCloseRequest(async () => {
      try {
        if (S.current) {
          await flushTitle();
          await flushSave();
        }
      } finally {
        window.desktop.closeReady();
      }
    });
  }
  let teamInfo = null;
  let teamReachError = false;
  try {
    teamInfo = await fetch('/api/team/info').then((r) => (r.ok ? r.json() : null));
  } catch {
    teamReachError = true;
  }
  if (teamInfo?.version) {
    requestAnimationFrame(() => document.body.classList.add('ready'));
    await startHosted();
    return;
  }
  if (teamReachError) {
    const offline = collectOfflinePages();
    if (offline.length) {
      requestAnimationFrame(() => document.body.classList.add('ready'));
      showOfflineBoot(offline);
      return;
    }
  }
  try {
    S.boot = await api.state();
  } catch {
    const offline = collectOfflinePages();
    if (offline.length) {
      showOfflineBoot(offline);
      return;
    }
    document.body.innerHTML = '<div class="fatal">Can’t reach the Local Notes Extended server. Is it running?</div>';
    return;
  }
  if (S.boot.vault) await openVault(S.boot.vault);
  else showWelcome();
  requestAnimationFrame(() => document.body.classList.add('ready'));
}

boot();

// for debugging from the console
window.__ln = { S, get editor() { return editor; }, compose: () => composeFile(), open: (p) => openNote(p) };
