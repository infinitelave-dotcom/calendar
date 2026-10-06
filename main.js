const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

const stateFile = path.join(app.getPath('userData'), 'window.json');
function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; }
}
function saveBounds(win) {
  try { fs.writeFileSync(stateFile, JSON.stringify(win.getBounds())); } catch {}
}

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const s = loadState();
  const win = new BrowserWindow({
    width: s.width || 420, height: s.height || 560,
    x: s.x, y: s.y,
    frame: false, transparent: true, resizable: true,
    skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.setMenu(null);
  win.loadFile('index.html');
  win.on('moved', () => saveBounds(win));
  win.on('resized', () => saveBounds(win));
}

ipcMain.handle('get-autostart', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('set-autostart', (_e, on) => app.setLoginItemSettings({ openAtLogin: !!on }));
ipcMain.on('notify', (_e, title, body) => new Notification({ title, body }).show());
ipcMain.on('quit', () => app.quit());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
