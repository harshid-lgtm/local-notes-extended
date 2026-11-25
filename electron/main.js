// Local Notes desktop app: embeds the vault server on a private localhost port and
// shows the UI in a frameless window with native folder dialogs and auto-updates.
'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { createVaultServer } = require('../server/core');

const IS_MAC = process.platform === 'darwin';
const ROOT = path.join(__dirname, '..');

// lets tests and portable setups keep settings out of the normal profile
if (process.env.LOCAL_NOTES_USER_DATA) app.setPath('userData', process.env.LOCAL_NOTES_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}

let win = null;
let port = 0;
const boundsFile = () => path.join(app.getPath('userData'), 'window.json');

function loadBounds() {
  try { return JSON.parse(fs.readFileSync(boundsFile(), 'utf8')); } catch { return { width: 1320, height: 860 }; }
}

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  const b = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  try { fs.writeFileSync(boundsFile(), JSON.stringify(b)); } catch { /* read-only profile */ }
}

function overlayColors(dark) {
  return dark ? { color: '#191918', symbolColor: '#d4d3cf', height: 46 } : { color: '#ffffff', symbolColor: '#5f5d58', height: 46 };
}

function createWindow() {
  const b = loadBounds();
  win = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 760, minHeight: 500,
    show: false,
    title: 'Local Notes',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#191918' : '#ffffff',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 18, y: 16 },
    titleBarOverlay: IS_MAC ? undefined : overlayColors(nativeTheme.shouldUseDarkColors),
    icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  if (b.maximized) win.maximize();
  win.loadURL(`http://localhost:${port}/`);
  win.once('ready-to-show', () => win.show());
  win.on('close', saveBounds);
  win.on('closed', () => { win = null; });

  const own = (url) => url.startsWith(`http://localhost:${port}/`);
  // links open in the system browser; the app itself never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!own(url)) { e.preventDefault(); if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); }
  });

  // right-click: spelling suggestions + clipboard actions
  win.webContents.on('context-menu', (_e, p) => {
    const items = [];
    for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
    if (p.misspelledWord) {
      items.push({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (p.isEditable) items.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { role: 'selectAll' });
    else if (p.selectionText) items.push({ role: 'copy' });
    if (p.linkURL && /^https?:/.test(p.linkURL)) items.push({ type: 'separator' }, { label: 'Copy link address', click: () => require('electron').clipboard.writeText(p.linkURL) });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
}

function buildMenu() {
  if (!IS_MAC) { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Local Notes on GitHub', click: () => shell.openExternal('https://github.com/harshid-lgtm/local-notes') }] },
  ]));
}

function setupUpdater() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', (info) => win?.webContents.send('update-ready', { version: info.version }));
  autoUpdater.on('error', () => { /* offline or no release yet: stay quiet */ });
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
  ipcMain.on('install-update', () => autoUpdater.quitAndInstall());
}

ipcMain.handle('pick-folder', async (_e, opts = {}) => {
  const r = await dialog.showOpenDialog(win, {
    title: opts.title || 'Choose a vault folder',
    buttonLabel: opts.button || 'Open vault',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('app-info', () => ({ version: app.getVersion(), platform: process.platform }));
ipcMain.on('set-theme', (_e, { dark }) => {
  if (win && !IS_MAC) { try { win.setTitleBarOverlay(overlayColors(dark)); } catch { /* unsupported */ } }
  if (win) win.setBackgroundColor(dark ? '#191918' : '#ffffff');
});
ipcMain.on('reveal', (_e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); });

app.whenReady().then(async () => {
  const { server } = createVaultServer({ configDir: app.getPath('userData'), publicDir: path.join(ROOT, 'public') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  buildMenu();
  createWindow();
  setupUpdater();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });
