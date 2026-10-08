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
  // 바탕화면 캐릭터
  setPet: (opts) => ipcRenderer.send('pet-set', opts),
  pickPetImage: () => ipcRenderer.invoke('pet-pick-image'),
  defaultPetImage: () => ipcRenderer.send('pet-default-image'),
  petMouse: (over) => ipcRenderer.send('pet-mouse', over),
  petDrag: (on, click) => ipcRenderer.send('pet-drag', on, click),
  petDouble: () => ipcRenderer.send('pet-double'),
  onPet: (ch, cb) => { if (ch === 'pet-config' || ch === 'pet-state') ipcRenderer.on(ch, (_e, d) => cb(d)); },
  // 유튜브 창
  setYoutube: (on) => ipcRenderer.send('yt-visible', on),
  ytAction: (name, arg) => ipcRenderer.send('yt-action', name, arg),
  onYt: (cb) => ipcRenderer.on('yt-state', (_e, s) => cb(s)),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  notify: (t, b) => ipcRenderer.send('notify', t, b),
  quit: () => ipcRenderer.send('quit')
});
