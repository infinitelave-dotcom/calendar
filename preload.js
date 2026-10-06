const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (on) => ipcRenderer.invoke('set-autostart', on),
  getPinned: () => ipcRenderer.invoke('get-pinned'),
  setPinned: (on) => ipcRenderer.invoke('set-pinned', on),
  notify: (t, b) => ipcRenderer.send('notify', t, b),
  quit: () => ipcRenderer.send('quit')
});
