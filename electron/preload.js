// The only bridge between the UI and the desktop shell.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Read once before the page runs so the synchronous store API can work. Writes
// go to the main process, which persists them in userData/settings.json.
const initialSettings = ipcRenderer.sendSync('settings:read') || {};

contextBridge.exposeInMainWorld('desktop', {
  settings: {
    has: (key) => Object.prototype.hasOwnProperty.call(initialSettings, key),
    get: (key) => initialSettings[key],
    set: (key, value) => {
      initialSettings[key] = value;
      ipcRenderer.send('settings:set', key, value);
    },
  },
  platform: process.platform,
  info: () => ipcRenderer.invoke('app-info'),
  pickFolder: (opts) => ipcRenderer.invoke('pick-folder', opts),
  setTheme: (dark) => ipcRenderer.send('set-theme', { dark }),
  reveal: (fullPath) => ipcRenderer.send('reveal', fullPath),
  openPath: (fullPath) => ipcRenderer.send('open-path', fullPath),
  onUpdateReady: (cb) => ipcRenderer.on('update-ready', (_e, info) => cb(info)),
  installUpdate: () => ipcRenderer.send('install-update'),
  onCloseRequest: (cb) => ipcRenderer.on('app-close-request', () => cb()),
  closeReady: () => ipcRenderer.send('app-close-ready'),
});
