const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (on) => ipcRenderer.invoke('set-autostart', on),
  setLocked: (on) => ipcRenderer.send('set-locked', on),
  setMemoLocked: (on) => ipcRenderer.send('set-memo-locked', on),
  desktopMode: () => ipcRenderer.send('desktop-mode'),
  setMemoVisible: (on) => ipcRenderer.send('set-memo-visible', on),
  checkUpdate: () => ipcRenderer.send('check-update'),
  reset: () => ipcRenderer.send('reset'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  notify: (t, b) => ipcRenderer.send('notify', t, b),
  quit: () => ipcRenderer.send('quit')
});
