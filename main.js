const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, globalShortcut, nativeImage } = require('electron');
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

// ── 윈도우 API: 창을 바탕화면 아이콘(폴더) 뒤에 붙이기 ─────────────────
// 바탕화면 아이콘 뒤에는 배경화면을 그리는 "WorkerW" 창이 있다.
// 캘린더 창을 그 창의 자식으로 넣으면 아이콘 뒤, 배경화면 앞에 표시된다.
// 대신 그 상태에서는 마우스 클릭을 받을 수 없어서 "편집 모드"로 꺼내서 쓴다.
let win32 = null;
if (process.platform === 'win32') {
  try {
    const koffi = require('koffi');
    const u = koffi.load('user32.dll');
    const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    const EnumProc = koffi.proto('bool __stdcall EnumProc(intptr hwnd, intptr lParam)');
    win32 = {
      RECT,
      FindWindowW: u.func('intptr __stdcall FindWindowW(str16 cls, str16 name)'),
      FindWindowExW: u.func('intptr __stdcall FindWindowExW(intptr parent, intptr after, str16 cls, str16 name)'),
      SendMessageTimeoutW: u.func('intptr __stdcall SendMessageTimeoutW(intptr hwnd, uint msg, uintptr wp, intptr lp, uint flags, uint timeout, _Out_ uintptr *result)'),
      EnumWindows: u.func('bool __stdcall EnumWindows(EnumProc *cb, intptr lParam)'),
      SetParent: u.func('intptr __stdcall SetParent(intptr child, intptr parent)'),
      GetWindowRect: u.func('bool __stdcall GetWindowRect(intptr hwnd, _Out_ RECT *rect)'),
      SetWindowPos: u.func('bool __stdcall SetWindowPos(intptr hwnd, intptr after, int x, int y, int cx, int cy, uint flags)'),
    };
  } catch (e) {
    console.error('윈도우 API를 불러오지 못했습니다:', e);
  }
}

function hwndOf(w) {
  const buf = w.getNativeWindowHandle();
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}

function findWorkerW() {
  const W = win32;
  const progman = W.FindWindowW('Progman', null);
  if (!progman) return 0;
  // 배경화면 뒤에 WorkerW 창을 만들어 달라고 탐색기에 요청
  W.SendMessageTimeoutW(progman, 0x052C, 0xD, 0x1, 0, 1000, [0]);
  W.SendMessageTimeoutW(progman, 0x052C, 0, 0, 0, 1000, [0]);
  let workerw = 0;
  // 기존 윈도우 10/11: 아이콘(SHELLDLL_DefView)을 가진 창 바로 다음의 WorkerW
  W.EnumWindows((hwnd) => {
    if (W.FindWindowExW(hwnd, 0, 'SHELLDLL_DefView', null)) {
      workerw = W.FindWindowExW(0, hwnd, 'WorkerW', null);
    }
    return true;
  }, 0);
  // 윈도우 11 24H2 이후: WorkerW가 Progman 안에 있음
  if (!workerw) workerw = W.FindWindowExW(progman, 0, 'WorkerW', null);
  return workerw;
}

const SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;
const HWND_BOTTOM = 1;

let win, tray;
let mode = 'edit';          // 'desktop' = 아이콘 뒤에 고정, 'edit' = 일정 편집 가능
let embedded = false;       // 실제로 WorkerW 안에 들어갔는지
let fallbackTimer = null;   // 붙이기에 실패했을 때 맨 뒤로 보내는 타이머

function enterDesktopMode() {
  mode = 'desktop';
  state.mode = mode; saveState();
  if (win32) {
    try {
      const hwnd = hwndOf(win);
      const r = {}; win32.GetWindowRect(hwnd, r);
      const workerw = findWorkerW();
      if (workerw) {
        const pr = {}; win32.GetWindowRect(workerw, pr);
        win32.SetParent(hwnd, workerw);
        win32.SetWindowPos(hwnd, 0, r.left - pr.left, r.top - pr.top, r.right - r.left, r.bottom - r.top,
                           SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
        embedded = true;
      }
    } catch (e) { console.error(e); }
    if (!embedded) {
      // 붙이지 못하면 다른 창들의 맨 뒤로라도 보낸다
      const back = () => { try { win32.SetWindowPos(hwndOf(win), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE); } catch {} };
      back(); fallbackTimer = setInterval(back, 1500);
    }
  }
  win.setIgnoreMouseEvents(embedded);
  notifyRenderer();
}

function enterEditMode() {
  mode = 'edit';
  state.mode = mode; saveState();
  if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
  if (win32 && embedded) {
    try {
      const hwnd = hwndOf(win);
      const r = {}; win32.GetWindowRect(hwnd, r);
      win32.SetParent(hwnd, 0);
      win32.SetWindowPos(hwnd, 0, r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_SHOWWINDOW);
    } catch (e) { console.error(e); }
    embedded = false;
  }
  win.setIgnoreMouseEvents(false);
  win.show(); win.focus();
  notifyRenderer();
}

function toggleMode() { mode === 'desktop' ? enterEditMode() : enterDesktopMode(); }

function setLocked(on) {
  state.locked = !!on; saveState();
  win.setMovable(!state.locked);
  win.setResizable(!state.locked);
  notifyRenderer();
}

function notifyRenderer() {
  if (win && !win.isDestroyed()) win.webContents.send('state', { mode, locked: !!state.locked });
  buildTrayMenu();
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: mode === 'desktop' ? '일정 편집하기 (Ctrl+Alt+C)' : '바탕화면에 고정하기 (Ctrl+Alt+C)', click: toggleMode },
    { label: '위치·크기 잠금', type: 'checkbox', checked: !!state.locked, click: (i) => setLocked(i.checked) },
    { label: '컴퓨터 켤 때 자동 실행', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]));
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => win && enterEditMode());

function createWindow() {
  const b = state.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1100, height: b.height || 720,
    minWidth: 700, minHeight: 480,
    x: b.x, y: b.y,
    frame: false, transparent: true, resizable: !state.locked, movable: !state.locked,
    skipTaskbar: true, hasShadow: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.setMenu(null);
  win.loadFile('index.html');
  const saveBounds = () => { if (mode === 'edit') { state.bounds = win.getBounds(); saveState(); } };
  win.on('moved', saveBounds);
  win.on('resized', saveBounds);
  win.webContents.on('did-finish-load', () => {
    notifyRenderer();
    if (state.mode !== 'edit') setTimeout(enterDesktopMode, 300);
    if (!state.seenHint) {
      state.seenHint = true; saveState();
      new Notification({ title: '바탕화면 캘린더', body: '일정을 추가하려면 작업 표시줄 오른쪽의 달력 아이콘을 클릭하거나 Ctrl+Alt+C 를 누르세요.' }).show();
    }
  });

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.setToolTip('바탕화면 캘린더 - 클릭하면 편집/고정 전환');
  tray.on('click', toggleMode);
  buildTrayMenu();

  globalShortcut.register('Control+Alt+C', toggleMode);
}

ipcMain.handle('get-autostart', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('set-autostart', (_e, on) => { app.setLoginItemSettings({ openAtLogin: !!on }); buildTrayMenu(); });
ipcMain.on('set-locked', (_e, on) => setLocked(on));
ipcMain.on('desktop-mode', () => enterDesktopMode());
ipcMain.on('notify', (_e, title, body) => new Notification({ title, body }).show());
ipcMain.on('quit', () => app.quit());

app.whenReady().then(createWindow);
app.on('before-quit', () => {
  // 종료 전에 바탕화면에서 떼어내야 창이 깔끔하게 닫힌다
  if (embedded) enterEditMode();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
