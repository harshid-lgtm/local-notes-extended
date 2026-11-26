// Local Notes vault server. Exposes one folder of markdown files (the "vault") over a
// small JSON API on 127.0.0.1, plus the bundled UI from ./public. Used by the desktop
// app (embedded) and by `npm start` (browser mode). No dependencies beyond Node.
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const ai = require('./ai');
const AnthropicSDK = require('@anthropic-ai/sdk');
const mammoth = require('mammoth');
const { VaultSearch } = require('./search');
const exportNote = require('./export');

const aiClient = ai.createAI({ Anthropic: AnthropicSDK.default || AnthropicSDK });

const IGNORED = new Set(['.git', '.obsidian', '.trash', 'node_modules', '.DS_Store', '__pycache__']);
const NOTE_EXT = '.md';
const TEXT_PREVIEW_EXT = new Set(['.txt', '.csv', '.json', '.xml', '.yaml', '.yml', '.log', '.html', '.htm', '.css', '.js', '.ts', '.md']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.svg', '.ico']);
const MEDIA_EXT = new Set(['.mp4', '.webm', '.mov', '.mp3', '.wav']);
const MAX_TREE_ENTRIES = 20000;
const IS_WIN = process.platform === 'win32';
const IS_WSL = !IS_WIN && os.release().toLowerCase().includes('microsoft');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip', '.webm': 'video/webm', '.mov': 'video/quicktime', '.wav': 'audio/wav',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const toPosix = (p) => p.split(path.sep).join('/');
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const stem = (name) => name.replace(/\.md$/i, '');

function cleanName(name) {
  return String(name || '').replace(/[\\/:*?"<>|#^[\]]/g, '').trim().replace(/^\.+|\.+$/g, '').slice(0, 180);
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const base = p.slice(0, p.length - ext.length);
  for (let i = 1; ; i++) {
    const c = `${base} ${i}${ext}`;
    if (!fs.existsSync(c)) return c;
  }
}

// ------------------------------------------------------------------ path input / display
function normalizeInput(raw) {
  let p = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!p) return null;
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  if (IS_WSL) {
    const m = p.match(/^([A-Za-z]):[\\/](.*)$/);
    if (m) p = `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
  }
  return path.resolve(p);
}

function displayPath(p) {
  if (IS_WSL) {
    const m = p.match(/^\/mnt\/([a-z])(\/.*)?$/);
    if (m) return `${m[1].toUpperCase()}:${(m[2] || '/').replace(/\//g, '\\')}`;
  }
  return p;
}

let winUser;
function windowsUserDir() {
  if (winUser !== undefined) return winUser;
  winUser = null;
  if (IS_WIN) winUser = os.homedir();
  else if (IS_WSL) {
    try {
      const name = execFileSync('cmd.exe', ['/c', 'echo %USERNAME%'], { cwd: '/mnt/c', timeout: 4000 }).toString().trim();
      if (name && isDir(`/mnt/c/Users/${name}`)) winUser = `/mnt/c/Users/${name}`;
    } catch { /* not available */ }
  }
  return winUser;
}

function shortcuts() {
  const out = [];
  const home = os.homedir();
  const add = (label, p, icon) => { if (p && isDir(p) && !out.some((o) => o.path === p)) out.push({ label, path: p, icon }); };
  const win = windowsUserDir();
  if (IS_WSL && win) {
    add('Windows home', win, 'home');
    for (const s of ['Documents', 'Desktop', 'OneDrive']) add(s, path.join(win, s), 'folder');
    add('Linux home', home, 'home');
    add('C: drive', '/mnt/c', 'drive');
    return out;
  }
  add('Home', home, 'home');
  for (const s of ['Documents', 'Desktop', 'OneDrive', 'iCloud Drive']) add(s, path.join(home, s), 'folder');
  if (process.platform === 'darwin') add('iCloud Drive', path.join(home, 'Library/Mobile Documents/com~apple~CloudDocs'), 'folder');
  if (IS_WIN) for (const l of 'CDEFGH') add(`${l}: drive`, `${l}:\\`, 'drive');
  return out;
}

function findObsidianVaults() {
  const home = os.homedir();
  const candidates = [path.join(home, '.config/obsidian/obsidian.json'), path.join(home, 'Library/Application Support/obsidian/obsidian.json')];
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'obsidian/obsidian.json'));
  if (IS_WSL && windowsUserDir()) candidates.push(path.join(windowsUserDir(), 'AppData/Roaming/obsidian/obsidian.json'));
  const found = [];
  const seen = new Set();
  for (const c of candidates) {
    let data;
    try { data = JSON.parse(fs.readFileSync(c, 'utf8')); } catch { continue; }
    for (const v of Object.values(data.vaults || {})) {
      const p = normalizeInput(v.path);
      if (p && isDir(p) && !seen.has(p)) { seen.add(p); found.push({ path: p, display: displayPath(p), name: path.basename(p) }); }
    }
  }
  return found;
}

// ------------------------------------------------------------------ link index (backlinks & graph)
const WIKI_RE = /(!?)\[\[([^\]\n|#]*)(#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g;
const MDLINK_RE = /\[[^\]\n]*\]\(([^)\s]+?\.md)(?:#[^)]*)?\)/gi;

class LinkIndex {
  constructor() { this.cache = new Map(); this.root = null; }

  reset(root) { this.root = root; this.cache.clear(); }

  async refresh(vault, notes) {
    if (this.root !== vault) this.reset(vault);
    const live = new Set(notes.map((n) => n.path));
    for (const k of this.cache.keys()) if (!live.has(k)) this.cache.delete(k);
    await Promise.all(notes.map(async (n) => {
      const hit = this.cache.get(n.path);
      if (hit && hit.mtime === n.mtime) return;
      let text = '';
      try { text = await fsp.readFile(path.join(vault, n.path), 'utf8'); } catch { /* unreadable */ }
      const raw = [];
      for (const m of text.matchAll(WIKI_RE)) if (!m[1] && m[2].trim()) raw.push({ kind: 'wiki', target: m[2].trim(), index: m.index });
      for (const m of text.matchAll(MDLINK_RE)) {
        let t; try { t = decodeURI(m[1]); } catch { t = m[1]; }
        if (!/^[a-z]+:/i.test(t)) raw.push({ kind: 'md', target: t, index: m.index });
      }
      this.cache.set(n.path, { mtime: n.mtime, text, raw });
    }));
    // resolve targets against the current note list
    const byStem = new Map();
    for (const n of notes) {
      const k = n.name.toLowerCase();
      if (!byStem.has(k)) byStem.set(k, []);
      byStem.get(k).push(n.path);
    }
    for (const list of byStem.values()) list.sort((a, b) => a.length - b.length);
    const byPath = new Map(notes.map((n) => [stem(n.path).toLowerCase(), n.path]));
    const resolve = (from, link) => {
      if (link.kind === 'md') {
        const rel = toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(from), link.target)));
        return byPath.get(stem(rel).toLowerCase()) || byStem.get(path.posix.basename(stem(link.target)).toLowerCase())?.[0] || null;
      }
      const t = stem(link.target).toLowerCase();
      return byPath.get(t) || byStem.get(path.posix.basename(t))?.[0] || null;
    };
    this.links = new Map();
    for (const [p, entry] of this.cache) {
      this.links.set(p, entry.raw.map((l) => ({ ...l, to: resolve(p, l) })));
    }
  }

  snippet(text, index) {
    const start = text.lastIndexOf('\n', index) + 1;
    let end = text.indexOf('\n', index);
    if (end < 0) end = text.length;
    let line = text.slice(start, end).trim().replace(/^(?:[-*+]\s+\[.\]\s+|[-*+>#]+\s*|\d+\.\s+)+/, '');
    if (line.length > 220) {
      const at = Math.max(0, index - start - 80);
      line = `${at ? '…' : ''}${line.slice(at, at + 200)}…`;
    }
    return line;
  }
}

// ------------------------------------------------------------------ server
function createVaultServer({ configDir, publicDir }) {
  const configPath = path.join(configDir, 'config.json');
  let config = { vault: null, recent: [] };
  try { config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) }; } catch { /* first run */ }
  const saveConfig = () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  };
  const index = new LinkIndex();
  const searchEngine = new VaultSearch();
  const aiOverride = (b = {}) => Object.fromEntries(['provider', 'apiKey', 'baseUrl', 'model'].filter((k) => b[k]).map((k) => [k, b[k]]));

  const currentVault = () => (config.vault && isDir(config.vault) ? config.vault : null);
  const vaultOrError = () => {
    const v = currentVault();
    if (!v) throw new ApiError(409, 'No vault selected');
    return v;
  };
  const vaultInfo = (v) => ({ path: v, display: displayPath(v), name: path.basename(v) || v });
  const safeJoin = (vault, rel) => {
    const target = path.resolve(vault, String(rel || '').replace(/\\/g, '/').replace(/^\/+/, ''));
    const relCheck = path.relative(vault, target);
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) throw new ApiError(403, 'Path escapes the vault');
    return target;
  };
  const relOf = (vault, p) => toPosix(path.relative(vault, p));

  function openVault(raw) {
    const p = normalizeInput(raw);
    if (!p || !isDir(p)) throw new ApiError(400, 'That folder doesn’t exist');
    config.vault = p;
    config.recent = [p, ...(config.recent || []).filter((r) => r !== p)].slice(0, 8);
    saveConfig();
    index.reset(p);
    searchEngine.reset(p);
    return vaultInfo(p);
  }

  async function buildTree(vault) {
    let count = 0;
    const files = [];
    const notes = [];
    async function walk(dir) {
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
      const folders = [];
      const ns = [];
      for (const e of entries) {
        if (count > MAX_TREE_ENTRIES) break;
        if (e.name.startsWith('.') || IGNORED.has(e.name)) continue;
        count++;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) folders.push({ type: 'folder', name: e.name, path: relOf(vault, full), children: await walk(full) });
        else if (e.isFile()) {
          const rel = relOf(vault, full);
          files.push(rel);
          let st;
          try { st = await fsp.stat(full); } catch { continue; }
          if (e.name.toLowerCase().endsWith(NOTE_EXT)) {
            const n = { type: 'note', name: stem(e.name), path: rel, mtime: st.mtimeMs / 1000, size: st.size };
            ns.push(n);
            notes.push(n);
          } else {
            // Non-markdown files stay in the same tree so PDFs, Word
            // documents, text files and media can be opened from the sidebar.
            ns.push({ type: 'file', name: e.name, path: rel, mtime: st.mtimeMs / 1000, size: st.size, ext: path.extname(e.name).toLowerCase() });
          }
        }
      }
      return [...folders, ...ns];
    }
    const tree = await walk(vault);
    return { tree, files, notes };
  }

  async function readExportImage(vault, notePath, src) {
    if (/^(?:[a-z]+:)?\/\//i.test(src) || /^data:/i.test(src)) return null;
    let rel = String(src).split(/[?#]/)[0];
    try { rel = decodeURIComponent(rel); } catch { /* keep literal */ }
    const candidates = [
      path.resolve(path.dirname(path.join(vault, notePath)), rel),
      path.resolve(vault, rel),
    ];
    for (const candidate of candidates) {
      if (candidate !== vault && !candidate.startsWith(vault + path.sep)) continue;
      if (isFile(candidate)) {
        try { return await fsp.readFile(candidate); } catch { /* try next */ }
      }
    }
    return null;
  }

  function obsidianSetting(vault, file) {
    try { return JSON.parse(fs.readFileSync(path.join(vault, '.obsidian', file), 'utf8')); } catch { return {}; }
  }

  // Moving "Page.md" also moves its subpage folder "Page/" (folder-note convention).
  function companionFolder(p) {
    if (!p.toLowerCase().endsWith(NOTE_EXT)) return null;
    const dir = p.slice(0, -NOTE_EXT.length);
    return isDir(dir) ? dir : null;
  }

  const routes = {
    'GET /api/state': () => {
      const v = currentVault();
      return {
        vault: v ? vaultInfo(v) : null,
        recent: (config.recent || []).filter(isDir).map(vaultInfo),
        obsidian: findObsidianVaults(),
        shortcuts: shortcuts(),
        home: os.homedir(),
        platform: process.platform,
      };
    },
    'POST /api/vault': (b) => ({ vault: openVault(b.path) }),
    'POST /api/vault/close': () => { config.vault = null; saveConfig(); return { ok: true }; },
    'POST /api/vault/forget': (b) => { config.recent = (config.recent || []).filter((r) => r !== b.path); saveConfig(); return { ok: true }; },
    'POST /api/vault/create': (b) => {
      const parent = normalizeInput(b.parent);
      if (!parent || !isDir(parent)) throw new ApiError(400, 'Choose where to create the vault');
      const name = cleanName(b.name) || 'My Notes';
      const dir = uniquePath(path.join(parent, name));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'Welcome.md'), WELCOME_NOTE);
      return { vault: openVault(dir) };
    },
    'GET /api/browse': (q) => {
      let p = normalizeInput(q.path) || os.homedir();
      if (!isDir(p)) throw new ApiError(400, 'Not a folder');
      let entries;
      try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { throw new ApiError(403, 'Permission denied'); }
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
      const dirs = [];
      let md = 0;
      for (const e of entries) {
        if (e.name.toLowerCase().endsWith(NOTE_EXT)) md++;
        if (e.name.startsWith('.') || e.name.startsWith('$') || IGNORED.has(e.name)) continue;
        let dir = e.isDirectory();
        if (e.isSymbolicLink()) dir = isDir(path.join(p, e.name));
        if (!dir) continue;
        const full = path.join(p, e.name);
        dirs.push({ name: e.name, path: full, isVault: isDir(path.join(full, '.obsidian')) });
      }
      const crumbs = [];
      for (let cur = p; ; cur = path.dirname(cur)) {
        crumbs.unshift({ name: path.basename(cur) || displayPath(cur), path: cur });
        if (path.dirname(cur) === cur) break;
      }
      return {
        path: p, display: displayPath(p), name: path.basename(p) || p, parent: path.dirname(p) !== p ? path.dirname(p) : null,
        crumbs, dirs, mdCount: md, isVault: isDir(path.join(p, '.obsidian')),
      };
    },
    'GET /api/tree': async () => {
      const v = vaultOrError();
      const { tree, files, notes } = await buildTree(v);
      // Keep the search index warm without making the sidebar wait for it.
      searchEngine.refresh(v, notes, { background: true }).catch(() => {});
      return { tree, files };
    },
    'GET /api/note': async (q) => {
      const v = vaultOrError();
      const p = safeJoin(v, q.path);
      if (!isFile(p)) throw new ApiError(404, 'Note not found');
      const st = fs.statSync(p);
      return { path: relOf(v, p), content: await fsp.readFile(p, 'utf8'), mtime: st.mtimeMs / 1000, ctime: st.birthtimeMs / 1000 };
    },
    'POST /api/file/import': async (b) => {
      const v = vaultOrError();
      const folder = safeJoin(v, b.folder || 'Imports');
      await fsp.mkdir(folder, { recursive: true });
      const imported = [];
      for (const file of Array.isArray(b.files) ? b.files : []) {
        const name = cleanName(String(file.name || 'imported-file')) || 'imported-file';
        const data = Buffer.from(String(file.data || ''), 'base64');
        if (!data.length || data.length > 100 * 1024 * 1024) continue;
        const target = uniquePath(path.join(folder, name));
        await fsp.writeFile(target, data);
        imported.push({ name: path.basename(target), path: relOf(v, target) });
      }
      return { files: imported };
    },
    'POST /api/file/import-path': async (b) => {
      const v = vaultOrError();
      const folder = safeJoin(v, b.folder || 'Imports');
      await fsp.mkdir(folder, { recursive: true });
      const imported = [];
      for (const source of Array.isArray(b.paths) ? b.paths : []) {
        if (typeof source !== 'string' || !isFile(source)) continue;
        const st = fs.statSync(source);
        if (st.size > 100 * 1024 * 1024) continue;
        const target = uniquePath(path.join(folder, path.basename(source)));
        await fsp.copyFile(source, target);
        imported.push({ name: path.basename(target), path: relOf(v, target) });
      }
      return { files: imported };
    },
    'POST /api/file/import-url': async (b) => {
      const v = vaultOrError();
      let url;
      try { url = new URL(String(b.url || '')); } catch { throw new ApiError(400, 'Enter a valid web address'); }
      if (!['http:', 'https:'].includes(url.protocol)) throw new ApiError(400, 'Only http and https addresses are supported');
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new ApiError(400, `The server returned ${res.status}`);
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > 100 * 1024 * 1024) throw new ApiError(400, 'File is larger than 100 MB');
      const cd = res.headers.get('content-disposition') || '';
      const encoded = cd.match(/filename\*=UTF-8''([^;]+)/i);
      const plain = cd.match(/filename="?([^";]+)"?/i);
      let name = '';
      try { name = encoded ? decodeURIComponent(encoded[1]) : plain ? plain[1] : path.basename(url.pathname); } catch { name = path.basename(url.pathname); }
      name = cleanName(name) || 'download';
      const folder = safeJoin(v, b.folder || 'Imports');
      await fsp.mkdir(folder, { recursive: true });
      const target = uniquePath(path.join(folder, name));
      await fsp.writeFile(target, data);
      return { files: [{ name: path.basename(target), path: relOf(v, target) }] };
    },
    'GET /api/file/preview': async (q) => {
      const v = vaultOrError();
      const p = safeJoin(v, q.path);
      if (!isFile(p)) throw new ApiError(404, 'File not found');
      const ext = path.extname(p).toLowerCase();
      const name = path.basename(p);
      if (ext === '.docx') {
        const result = await mammoth.convertToHtml({ path: p });
        return { name, ext, kind: 'docx', html: result.value, messages: result.messages.map((m) => m.message) };
      }
      if (TEXT_PREVIEW_EXT.has(ext)) {
        return { name, ext, kind: 'text', text: await fsp.readFile(p, 'utf8') };
      }
      if (IMAGE_EXT.has(ext)) return { name, ext, kind: 'image' };
      if (ext === '.pdf') return { name, ext, kind: 'pdf' };
      if (MEDIA_EXT.has(ext)) return { name, ext, kind: 'media' };
      return { name, ext, kind: 'external' };
    },
    'GET /api/stat': (q) => {
      const v = vaultOrError();
      const p = safeJoin(v, q.path);
      return isFile(p) ? { exists: true, mtime: fs.statSync(p).mtimeMs / 1000 } : { exists: false, mtime: null };
    },
    'PUT /api/note': async (b) => {
      const v = vaultOrError();
      const p = safeJoin(v, b.path);
      if (!p.toLowerCase().endsWith(NOTE_EXT)) throw new ApiError(400, 'Only markdown notes can be written');
      await fsp.mkdir(path.dirname(p), { recursive: true });
      const tmp = path.join(path.dirname(p), `.${path.basename(p)}.tmp`);
      await fsp.writeFile(tmp, String(b.content ?? ''), 'utf8');
      await fsp.rename(tmp, p);
      return { mtime: fs.statSync(p).mtimeMs / 1000 };
    },
    'POST /api/note/create': (b) => {
      const v = vaultOrError();
      const folder = safeJoin(v, b.folder || '');
      fs.mkdirSync(folder, { recursive: true });
      const name = cleanName(b.name || 'Untitled') || 'Untitled';
      const p = b.exact && fs.existsSync(path.join(folder, `${name}${NOTE_EXT}`)) ? null : uniquePath(path.join(folder, `${name}${NOTE_EXT}`));
      if (!p) return { path: relOf(v, path.join(folder, `${name}${NOTE_EXT}`)), name, existed: true };
      fs.writeFileSync(p, String(b.content || ''), 'utf8');
      return { path: relOf(v, p), name: stem(path.basename(p)) };
    },
    'POST /api/folder/create': (b) => {
      const v = vaultOrError();
      const parent = safeJoin(v, b.parent || '');
      const p = uniquePath(path.join(parent, cleanName(b.name || 'New folder') || 'New folder'));
      fs.mkdirSync(p, { recursive: true });
      return { path: relOf(v, p), name: path.basename(p) };
    },
    'POST /api/rename': (b) => {
      const v = vaultOrError();
      const src = safeJoin(v, b.from);
      if (!fs.existsSync(src) || src === v) throw new ApiError(404, 'Not found');
      const parts = String(b.to || '').replace(/\\/g, '/').split('/').map(cleanName).filter(Boolean);
      if (!parts.length) throw new ApiError(400, 'Invalid name');
      if (isFile(src) && src.toLowerCase().endsWith(NOTE_EXT) && !parts[parts.length - 1].toLowerCase().endsWith(NOTE_EXT)) parts[parts.length - 1] += NOTE_EXT;
      const dst = safeJoin(v, parts.join('/'));
      if (isDir(src) && (dst === src || dst.startsWith(src + path.sep))) throw new ApiError(400, 'Can’t move a folder into itself');
      if (dst === src) return { path: relOf(v, dst) };
      const sameEntry = fs.existsSync(dst) && dst.toLowerCase() === src.toLowerCase();
      if (fs.existsSync(dst) && !sameEntry) throw new ApiError(409, `“${path.basename(dst)}” already exists there`);
      const companion = companionFolder(src);
      const companionDst = companion ? dst.slice(0, -NOTE_EXT.length) : null;
      if (companionDst && fs.existsSync(companionDst) && companionDst.toLowerCase() !== companion.toLowerCase()) {
        throw new ApiError(409, `A folder “${path.basename(companionDst)}” already exists there`);
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(src, dst);
      if (companion) fs.renameSync(companion, companionDst);
      return { path: relOf(v, dst), companion: companion ? { from: relOf(v, companion), to: relOf(v, companionDst) } : null };
    },
    'POST /api/delete': (b) => {
      const v = vaultOrError();
      const p = safeJoin(v, b.path);
      if (!fs.existsSync(p) || p === v) throw new ApiError(404, 'Not found');
      const trash = path.join(v, '.trash');
      fs.mkdirSync(trash, { recursive: true });
      const companion = companionFolder(p);
      fs.renameSync(p, uniquePath(path.join(trash, path.basename(p))));
      if (companion) fs.renameSync(companion, uniquePath(path.join(trash, path.basename(companion))));
      return { ok: true };
    },
    'GET /api/search': async (q) => {
      const v = vaultOrError();
      const { notes } = await buildTree(v);
      await searchEngine.refresh(v, notes);
      const limit = Math.min(100, Math.max(1, Number(q.limit) || 40));
      return { results: searchEngine.search(q.q || '', notes, limit) };
    },
    'POST /api/export': async (b) => {
      const v = vaultOrError();
      const full = safeJoin(v, b.path);
      if (!isFile(full) || !full.toLowerCase().endsWith(NOTE_EXT)) throw new ApiError(404, 'Note not found');
      const rel = relOf(v, full);
      const markdown = await fsp.readFile(full, 'utf8');
      const base = stem(path.basename(rel));
      const result = await exportNote({
        title: base,
        markdown,
        format: b.format,
        baseName: base,
        readImage: (src) => readExportImage(v, rel, src),
      });
      return {
        __download: true,
        filename: result.filename,
        mime: result.mime,
        buffer: result.buffer,
      };
    },
    'GET /api/links': async (q) => {
      // backlinks + unlinked mentions for one note
      const v = vaultOrError();
      const { notes } = await buildTree(v);
      await index.refresh(v, notes);
      const target = q.path;
      const title = stem(path.posix.basename(target || ''));
      const linked = [];
      const unlinked = [];
      const titleRe = title.length > 2 ? new RegExp(`(^|[^\\w[])${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w\\]])`, 'i') : null;
      for (const [p, links] of index.links) {
        if (p === target) continue;
        const entry = index.cache.get(p);
        const hits = links.filter((l) => l.to === target);
        const name = stem(path.posix.basename(p));
        if (hits.length) {
          linked.push({ path: p, title: name, snippets: [...new Set(hits.slice(0, 3).map((h) => index.snippet(entry.text, h.index)))] });
        } else if (titleRe) {
          const m = entry.text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').match(titleRe);
          if (m) unlinked.push({ path: p, title: name, snippets: [index.snippet(entry.text, entry.text.indexOf(m[0]) + m[1].length)] });
        }
      }
      const outgoing = [...new Set((index.links.get(target) || []).filter((l) => l.to).map((l) => l.to))];
      linked.sort((a, b) => a.title.localeCompare(b.title));
      return { linked, unlinked: unlinked.slice(0, 20), outgoing };
    },
    'GET /api/graph': async () => {
      const v = vaultOrError();
      const { notes: all } = await buildTree(v);
      await index.refresh(v, all);
      const tplFolder = `${toPosix(obsidianSetting(v, 'templates.json').folder || 'Templates').replace(/\/+$/, '')}/`;
      const notes = all.filter((n) => !n.path.startsWith(tplFolder));
      const keep = new Set(notes.map((n) => n.path));
      const nodes = notes.map((n) => ({ id: n.path, name: n.name, folder: n.path.includes('/') ? n.path.split('/')[0] : '', mtime: n.mtime }));
      const edges = [];
      const unresolved = new Map();
      for (const [from, links] of index.links) {
        if (!keep.has(from)) continue;
        const seen = new Set();
        for (const l of links) {
          if (l.to && keep.has(l.to) && l.to !== from && !seen.has(l.to)) { seen.add(l.to); edges.push({ source: from, target: l.to }); }
          if (!l.to && l.kind === 'wiki') {
            const id = `?${stem(l.target).toLowerCase()}`;
            if (!unresolved.has(id)) unresolved.set(id, { id, name: stem(path.posix.basename(l.target)), unresolved: true });
            if (!seen.has(id)) { seen.add(id); edges.push({ source: from, target: id }); }
          }
        }
      }
      return { nodes: [...nodes, ...unresolved.values()], edges };
    },
    'GET /api/templates': () => {
      const v = vaultOrError();
      const folder = obsidianSetting(v, 'templates.json').folder || 'Templates';
      const dir = safeJoin(v, folder);
      const list = isDir(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(NOTE_EXT)).sort() : [];
      return { folder: toPosix(folder), templates: list.map((f) => ({ name: stem(f), path: toPosix(path.join(folder, f)) })) };
    },
    'POST /api/templates/install': () => {
      const v = vaultOrError();
      const folder = obsidianSetting(v, 'templates.json').folder || 'Templates';
      const dir = safeJoin(v, folder);
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, body] of Object.entries(STARTER_TEMPLATES)) {
        const p = path.join(dir, `${name}${NOTE_EXT}`);
        if (!fs.existsSync(p)) fs.writeFileSync(p, body);
      }
      return { ok: true };
    },
    'GET /api/daily': () => {
      const v = vaultOrError();
      const s = obsidianSetting(v, 'daily-notes.json');
      return { folder: s.folder || '', format: s.format || 'YYYY-MM-DD', template: s.template || '' };
    },

    // ---- AI (keys stay in this machine's config; requests go straight to the provider)
    'GET /api/ai/settings': () => ai.publicSettings(config.ai),
    'PUT /api/ai/settings': (b) => {
      config.ai = ai.applySettings(config.ai, b);
      saveConfig();
      return ai.publicSettings(config.ai);
    },
    'POST /api/ai/models': async (b) => ({ models: await aiClient.listModels(config.ai || {}, aiOverride(b)) }),
    'POST /api/ai/test': async (b) => ({ reply: await aiClient.test(config.ai || {}, aiOverride(b)) }),
  };

  // Streams NDJSON lines: {sources} first (ask only), then {delta}…, then {done} or {error}.
  async function streamAI(req, res, kind) {
    const b = JSON.parse((await readBody(req)) || '{}');
    let gen;
    let head = null;
    if (kind === 'ask') {
      const v = vaultOrError();
      const { notes } = await buildTree(v);
      await index.refresh(v, notes);
      const tpl = `${toPosix(obsidianSetting(v, 'templates.json').folder || 'Templates')}/`;
      const docs = notes.filter((n) => !n.path.startsWith(tpl)).map((n) => ({ id: n.path, title: n.name, text: (index.cache.get(n.path)?.text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '') }));
      const picked = ai.pickNotes(b.question || '', docs, { currentId: b.currentPath || null });
      const history = (Array.isArray(b.history) ? b.history : []).slice(-8).filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string');
      gen = (signal) => aiClient.stream(config.ai || {}, { ...ai.askPrompt(picked, path.basename(v)), messages: [...history, { role: 'user', content: String(b.question || '') }], effort: 'medium', maxTokens: 16000, signal });
      head = { sources: picked.map((p) => ({ id: p.id, title: p.title })) };
    } else {
      gen = (signal) => aiClient.stream(config.ai || {}, { system: String(b.system || ''), messages: [{ role: 'user', content: String(b.prompt || '') }], effort: ['low', 'medium', 'high'].includes(b.effort) ? b.effort : 'low', maxTokens: 16000, signal });
    }
    const ac = new AbortController();
    const iterator = gen(ac.signal); // throws now if AI isn't configured -> normal JSON error
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
    res.on('close', () => { if (!res.writableEnded) ac.abort(); });
    if (head) res.write(`${JSON.stringify(head)}\n`);
    try {
      for await (const t of iterator) res.write(`${JSON.stringify({ delta: t })}\n`);
      res.write('{"done":true}\n');
    } catch (e) {
      if (e.name !== 'AbortError') res.write(`${JSON.stringify({ error: e.message || 'The AI request failed' })}\n`);
    }
    res.end();
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const host = (req.headers.host || '').split(':')[0];
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return sendJson(res, 403, { error: 'Forbidden host' });
    try {
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'POST' && (url.pathname === '/api/ai/complete' || url.pathname === '/api/ai/ask')) {
          if (!String(req.headers['content-type'] || '').includes('application/json')) throw new ApiError(415, 'Expected JSON');
          return await streamAI(req, res, url.pathname.endsWith('ask') ? 'ask' : 'complete');
        }
        if (url.pathname === '/api/file' && req.method === 'GET') {
          const v = vaultOrError();
          const p = safeJoin(v, url.searchParams.get('path'));
          if (!isFile(p)) throw new ApiError(404, 'Not found');
          return sendFile(res, p, false);
        }
        const fn = routes[`${req.method} ${url.pathname}`];
        if (!fn) throw new ApiError(404, 'Unknown endpoint');
        let input = Object.fromEntries(url.searchParams);
        if (req.method !== 'GET') {
          if (!String(req.headers['content-type'] || '').includes('application/json')) throw new ApiError(415, 'Expected JSON');
          input = JSON.parse((await readBody(req)) || '{}');
        }
        const result = await fn(input);
        if (result && result.__download) {
          const asciiName = result.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
          res.writeHead(200, {
            'Content-Type': result.mime,
            'Content-Length': result.buffer.length,
            'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
            'Cache-Control': 'no-store',
          });
          return res.end(result.buffer);
        }
        return sendJson(res, 200, result);
      }
      if (req.method !== 'GET') throw new ApiError(405, 'Method not allowed');
      let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      let target = path.resolve(publicDir, rel);
      if (!target.startsWith(path.resolve(publicDir) + path.sep) || !isFile(target)) target = path.join(publicDir, 'index.html');
      return sendFile(res, target, url.pathname.startsWith('/fonts/'));
    } catch (e) {
      if (res.headersSent) return undefined;
      return sendJson(res, e.status || 500, { error: e.message || String(e) });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  return { server, openVault, getConfig: () => config };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendFile(res, p, immutable) {
  fs.readFile(p, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    return res.end(data);
  });
}

const WELCOME_NOTE = `# Welcome to Local Notes

This vault is just a folder of markdown files. Everything you write here is saved as a \`.md\` file you own.

> [!tip] Three things to try
> Type / on an empty line for blocks, type [[ to link a page, and press Ctrl+K to search.

- [ ] Create your first page
- [ ] Link two pages together, then open the graph
`;

const STARTER_TEMPLATES = {
  'Meeting notes': `---
date: {{date}}
attendees: []
tags: [meeting]
---
## Agenda

- First topic

## Notes

## Action items

- [ ] Owner — next step
`,
  'Project brief': `---
status: Planning
owner: Unassigned
tags: [project]
---
> [!abstract] Summary
> One or two sentences on what this project is and why it matters.

## Goals

- What does success look like?

## Scope

## Milestones

| Milestone | Date | Status |
| --- | --- | --- |
| Kickoff | {{date}} | Planned |

## Open questions

- What could block us?
`,
  'Daily note': `## Focus

- [ ] Most important thing today

## Log

## Gratitude
`,
  'Wiki page': `> [!info] Owner: Unassigned · Last reviewed {{date}}

## Overview

## How it works

## Related

- Link related pages here
`,
};

module.exports = { createVaultServer, ApiError };
