// Small, dependency-free UI primitives: menus, modals, toasts, confirm dialogs.
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? '⌘' : 'Ctrl';

export function timeAgo(ts) {
  const s = (Date.now() / 1000 - ts);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: s > 86400 * 300 ? 'numeric' : undefined });
}

// ------------------------------------------------------------------ menus
let openMenu = null;

export function closeMenu() {
  if (!openMenu) return;
  const m = openMenu;
  openMenu = null;
  m.cleanup();
  m.el.classList.add('leaving');
  setTimeout(() => m.el.remove(), 120);
}

/**
 * items: [{label, icon, hint, danger, checked, run}] | 'sep' | {header} | {custom: HTMLElement}
 * at: {x, y} or an anchor element.
 */
export function showMenu(items, at, { align = 'start', className = '' } = {}) {
  closeMenu();
  const el = h(`<div class="menu pop ${className}" role="menu"></div>`);
  const actionable = [];
  for (const it of items) {
    if (it === 'sep') { el.append(h('<div class="menu-sep"></div>')); continue; }
    if (it.header) { el.append(h(`<div class="menu-header">${esc(it.header)}</div>`)); continue; }
    if (it.custom) { el.append(it.custom); continue; }
    if (it.footer) { el.append(h(`<div class="menu-footer">${it.footer}</div>`)); continue; }
    const b = h(`<button class="menu-item ${it.danger ? 'danger' : ''}" role="menuitem">
      <span class="mi-icon">${it.icon ? icon(it.icon, 16) : ''}</span>
      <span class="mi-label">${esc(it.label)}</span>
      ${it.hint ? `<span class="mi-hint">${esc(it.hint)}</span>` : ''}
      ${it.checked ? `<span class="mi-check">${icon('check', 15, 2)}</span>` : ''}
    </button>`);
    b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); it.run?.(); });
    actionable.push(b);
    el.append(b);
  }
  document.body.append(el);
  place(el, at, align);
  let idx = -1;
  const focusIdx = (i) => { idx = (i + actionable.length) % actionable.length; actionable[idx]?.focus(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusIdx(idx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusIdx(idx - 1); }
  };
  const onDown = (e) => { if (!el.contains(e.target)) closeMenu(); };
  setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
  });
  openMenu = {
    el,
    cleanup() {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    },
  };
  return el;
}

export function place(el, at, align = 'start') {
  const r = at instanceof Element ? at.getBoundingClientRect() : { left: at.x, right: at.x, top: at.y, bottom: at.y };
  const w = el.offsetWidth, hgt = el.offsetHeight, pad = 8;
  let x = align === 'end' ? r.right - w : r.left;
  let y = r.bottom + 6;
  if (y + hgt > innerHeight - pad) y = Math.max(pad, r.top - hgt - 6);
  x = Math.min(Math.max(pad, x), innerWidth - w - pad);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

// ------------------------------------------------------------------ modals
export function openModal(content, { className = '', onClose } = {}) {
  closeMenu();
  const back = h(`<div class="modal-back"><div class="modal pop ${className}" role="dialog" aria-modal="true"></div></div>`);
  const box = back.firstElementChild;
  box.append(content);
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    back.classList.add('leaving');
    setTimeout(() => back.remove(), 160);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.menu')) { e.preventDefault(); e.stopPropagation(); close(); } };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  return { el: box, close };
}

export function confirmDialog({ title, body, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const c = h(`<div class="confirm">
      <div class="confirm-icon ${danger ? 'danger' : ''}">${icon(danger ? 'trash' : 'info', 20)}</div>
      <h3>${esc(title)}</h3><p>${body}</p>
      <div class="confirm-actions">
        <button class="btn ghost" data-no>Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(confirm)}</button>
      </div></div>`);
    const m = openModal(c, { className: 'small', onClose: () => { if (!done) resolve(false); } });
    c.querySelector('[data-no]').onclick = () => m.close();
    c.querySelector('[data-yes]').onclick = () => { done = true; resolve(true); m.close(); };
    setTimeout(() => c.querySelector('[data-yes]').focus(), 30);
  });
}

// ------------------------------------------------------------------ toasts
export function toast(message, { kind = 'info', timeout = 2600, action = null } = {}) {
  let wrap = $('.toasts');
  if (!wrap) { wrap = h('<div class="toasts"></div>'); document.body.append(wrap); }
  const ic = { info: 'info', success: 'success', error: 'error', update: 'sparkles' }[kind];
  const t = h(`<div class="toast ${kind}">${icon(ic, 16)}<span>${esc(message)}</span>${action ? `<button class="toast-btn">${esc(action.label)}</button>` : ''}</div>`);
  if (action) t.querySelector('.toast-btn').onclick = () => { action.run(); t.remove(); };
  wrap.append(t);
  if (timeout) setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 200); }, timeout);
}

// ------------------------------------------------------------------ prefs
const desktopStore = window.desktop?.settings;

export const store = {
  get(key, fallback) {
    if (desktopStore?.has(key)) return desktopStore.get(key);
    try {
      const v = localStorage.getItem(key);
      if (v == null) return fallback;
      const parsed = JSON.parse(v);
      // Migrate values written by older builds before the file-backed store.
      desktopStore?.set(key, parsed);
      return parsed;
    } catch { return fallback; }
  },
  set(key, value) {
    desktopStore?.set(key, value);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

// navigator.clipboard only exists on https/localhost; office servers run on plain http,
// so fall back to a hidden textarea + execCommand there.
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

// A Blob download works in Electron, desktop browsers and mobile browsers. iOS
// opens the Files share sheet for the generated file.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'export';
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
