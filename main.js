const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

const stateFile = path.join(app.getPath('userData'), 'window-v2.json');
function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; }
}
let state = loadState();
function saveState() {
  try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch {}
}

// 윈도우 API로 창을 다른 모든 창의 맨 뒤(바탕화면 바로 위)로 보낸다
let sendToBack = () => {};
if (process.platform === 'win32') {
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const SetWindowPos = user32.func('bool __stdcall SetWindowPos(intptr hWnd, intptr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags)');
    const HWND_BOTTOM = 1;
    const FLAGS = 0x0001 | 0x0002 | 0x0010; // NOSIZE | NOMOVE | NOACTIVATE
    sendToBack = (win) => {
      const buf = win.getNativeWindowHandle();
      const hwnd = buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
      SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, FLAGS);
    };
  } catch (e) {
    console.error('맨 뒤 고정 기능을 불러오지 못했습니다:', e);
  }
}

if (!app.requestSingleInstanceLock()) app.quit();

let win;
function pinned() { return state.pinned !== false; }
function keepBack() { if (win && pinned()) sendToBack(win); }

function createWindow() {
  const b = state.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1100, height: b.height || 720,
    minWidth: 700, minHeight: 480,
    x: b.x, y: b.y,
    frame: false, transparent: true, resizable: true,
    skipTaskbar: true, hasShadow: false,
    minimizable: false, maximizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.setMenu(null);
  win.loadFile('index.html');
  const saveBounds = () => { state.bounds = win.getBounds(); saveState(); };
  win.on('moved', saveBounds);
  win.on('resized', saveBounds);
  win.once('ready-to-show', keepBack);
  win.on('show', keepBack);
  win.on('focus', () => setTimeout(keepBack, 50));
  win.on('blur', keepBack);
  setInterval(keepBack, 2000);
}

ipcMain.handle('get-autostart', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('set-autostart', (_e, on) => app.setLoginItemSettings({ openAtLogin: !!on }));
ipcMain.handle('get-pinned', () => pinned());
ipcMain.handle('set-pinned', (_e, on) => { state.pinned = !!on; saveState(); keepBack(); });
ipcMain.on('notify', (_e, title, body) => new Notification({ title, body }).show());
ipcMain.on('quit', () => app.quit());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
