// The only bridge between the UI and the desktop shell.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  info: () => ipcRenderer.invoke('app-info'),
  pickFolder: (opts) => ipcRenderer.invoke('pick-folder', opts),
  setTheme: (dark) => ipcRenderer.send('set-theme', { dark }),
  reveal: (fullPath) => ipcRenderer.send('reveal', fullPath),
  onUpdateReady: (cb) => ipcRenderer.on('update-ready', (_e, info) => cb(info)),
  installUpdate: () => ipcRenderer.send('install-update'),
});
