const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (on) => ipcRenderer.invoke('set-autostart', on),
  notify: (t, b) => ipcRenderer.send('notify', t, b),
  quit: () => ipcRenderer.send('quit')
});
