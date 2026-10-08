const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, globalShortcut, nativeImage, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// 윈도우 작업 표시줄이 이 앱을 알아보게 (작업 표시줄 버튼·알림에 필요)
if (process.platform === 'win32') app.setAppUserModelId('com.ilsang.desktopcalendar');
// 구글 로그인 차단을 피하려고 크롬 전용 브라우저 정보(User-Agent Client Hints)를 끈다
app.commandLine.appendSwitch('disable-features', 'UserAgentClientHint');
const { createPet } = require('./pet');
const { createYouTube } = require('./youtube');
const { createPomodoro } = require('./pomodoro');

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
// 창을 그 창의 자식으로 넣으면 아이콘 뒤, 배경화면 앞에 표시된다.
// 대신 그 상태에서는 마우스 클릭을 받을 수 없어서 "편집 모드"로 꺼내서 쓴다.
let win32 = null;
if (process.platform === 'win32') {
  try {
    const koffi = require('koffi');
    const u = koffi.load('user32.dll');
    koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    koffi.proto('bool __stdcall EnumProc(intptr hwnd, intptr lParam)');
    win32 = {
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

// ── 창 관리: 달력 창 + 메모 창 ───────────────────────────────────
// 각 창은 { win, key, embedded } 로 관리하고, 고정/편집/잠금을 함께 적용한다.
const managed = {};
let mode = 'edit';          // 'desktop' = 아이콘 뒤에 고정, 'edit' = 편집 가능
let fallbackTimer = null;   // 붙이기에 실패했을 때 맨 뒤로 보내는 타이머

function embed(m) {
  if (!win32 || m.embedded || !m.win.isVisible()) return;
  try {
    const hwnd = hwndOf(m.win);
    const r = {}; win32.GetWindowRect(hwnd, r);
    const workerw = findWorkerW();
    if (!workerw) return;
    const pr = {}; win32.GetWindowRect(workerw, pr);
    win32.SetParent(hwnd, workerw);
    win32.SetWindowPos(hwnd, 0, r.left - pr.left, r.top - pr.top, r.right - r.left, r.bottom - r.top,
                       SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    m.embedded = true;
  } catch (e) { console.error(e); }
}

function unembed(m) {
  if (!win32 || !m.embedded) return;
  try {
    const hwnd = hwndOf(m.win);
    const r = {}; win32.GetWindowRect(hwnd, r);
    win32.SetParent(hwnd, 0);
    win32.SetWindowPos(hwnd, 0, r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_SHOWWINDOW);
  } catch (e) { console.error(e); }
  m.embedded = false;
}

function allWindows() { return Object.values(managed).filter(m => m.win && !m.win.isDestroyed()); }
const mainWin = () => managed.main && !managed.main.win.isDestroyed() ? managed.main.win : null;
const memoWin = () => managed.memo && !managed.memo.win.isDestroyed() ? managed.memo.win : null;

// ── 메모 창은 항상 달력보다 위 ──
// 달력이 바탕화면 아이콘 뒤에 붙어 있으면 메모(일반 창)는 자연히 그 위에 있다.
// 달력이 일반 창일 때(편집 모드, 붙이기 실패)는 달력을 메모 바로 아래로 내린다.
function keepMemoAbove() {
  const main = mainWin(), memo = memoWin();
  if (!win32 || !main || !memo || !memo.isVisible() || managed.main.embedded) return;
  try { win32.SetWindowPos(hwndOf(main), hwndOf(memo), 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE); } catch {}
}
// 바탕화면 모드에서 메모를 다른 프로그램 창들 뒤로 보낸다 (달력보다는 위 유지)
function sinkToBottom() {
  if (!win32) return;
  const memo = memoWin(), main = mainWin();
  try {
    if (main && !managed.main.embedded && main.isVisible()) win32.SetWindowPos(hwndOf(main), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
    if (memo && memo.isVisible() && !memo.isFocused()) win32.SetWindowPos(hwndOf(memo), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
  } catch {}
  keepMemoAbove();
}

function enterDesktopMode() {
  mode = 'desktop';
  state.mode = mode; saveState();
  embed(managed.main);          // 바탕화면 아이콘 뒤에는 달력만 붙인다
  if (fallbackTimer) clearInterval(fallbackTimer);
  // 달력을 붙이지 못했으면 다른 창들의 맨 뒤로라도 계속 보낸다
  if (win32 && !managed.main.embedded) fallbackTimer = setInterval(sinkToBottom, 1500);
  sinkToBottom();
  notifyRenderers();
}

function enterEditMode() {
  mode = 'edit';
  state.mode = mode; saveState();
  if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
  unembed(managed.main);
  mainWin().show(); mainWin().focus();
  setTimeout(keepMemoAbove, 50);
  notifyRenderers();
}

function toggleMode() { mode === 'desktop' ? enterEditMode() : enterDesktopMode(); }

// 달력 잠금과 메모 잠금은 따로
function setLocked(on) {
  state.locked = !!on; saveState();
  const w = mainWin(); if (w) { w.setMovable(!state.locked); w.setResizable(!state.locked); }
  notifyRenderers();
}
function setMemoLocked(on) {
  state.memoLocked = !!on; saveState();
  const w = memoWin(); if (w) { w.setMovable(!state.memoLocked); w.setResizable(!state.memoLocked); }
  notifyRenderers();
}

function notifyRenderers() {
  const s = { mode, locked: !!state.locked, memoLocked: !!state.memoLocked, memoVisible: state.memoVisible !== false, version: app.getVersion(),
             pet: { visible: state.petVisible !== false, size: state.petSize || 96, custom: !!(state.petImage || state.petPack) },
             ytVisible: yt.visible(), pomoVisible: pomo.visible() };
  allWindows().forEach(m => m.win.webContents.send('state', s));
  buildTrayMenu();
}

function makeWindow(key, file, defaults) {
  const b = (state.windows && state.windows[key]) || (key === 'main' ? state.bounds : null) || {};
  const locked = key === 'memo' ? !!state.memoLocked : !!state.locked;
  const win = new BrowserWindow({
    width: b.width || defaults.width, height: b.height || defaults.height,
    minWidth: defaults.minWidth, minHeight: defaults.minHeight,
    x: b.x ?? defaults.x, y: b.y ?? defaults.y,
    frame: false, transparent: true, resizable: !locked, movable: !locked,
    skipTaskbar: true, hasShadow: false, show: defaults.show !== false,
    minimizable: false, maximizable: false, fullscreenable: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.setMenu(null);
  win.loadFile(file);
  const m = { win, key, embedded: false };
  managed[key] = m;
  const saveBounds = () => {
    if (key === 'main' && mode !== 'edit') return;   // 붙어 있는 동안의 좌표는 저장하지 않는다
    state.windows = state.windows || {};
    state.windows[key] = win.getBounds(); saveState();
  };
  win.on('moved', saveBounds);
  win.on('resized', saveBounds);
  win.on('close', (e) => {
    // 메모 창의 닫기는 숨기기로 처리
    if (key === 'memo' && !quitting) { e.preventDefault(); setMemoVisible(false); }
  });
  win.webContents.on('did-finish-load', notifyRenderers);
  return m;
}

function setMemoVisible(on) {
  state.memoVisible = !!on; saveState();
  const w = memoWin(); if (!w) return;
  if (on) { w.show(); keepMemoAbove(); } else w.hide();
  notifyRenderers();
}

// ── 바탕화면 캐릭터 ──
const pet = createPet({
  getState: () => state, saveState,
  preload: path.join(__dirname, 'preload.js'),
  onDoubleClick: () => enterEditMode(),      // 캐릭터를 더블클릭하면 달력 편집
});
function setPet({ visible, size }) {
  if (visible !== undefined) state.petVisible = !!visible;
  if (size !== undefined) state.petSize = Math.round(size);
  saveState(); pet.apply(); notifyRenderers();
}

// ── 작은 유튜브 창 ──
const yt = createYouTube({
  getState: () => state, saveState,
  preload: path.join(__dirname, 'preload.js'),
  onVisibilityChange: () => notifyRenderers(),
});
const setYoutube = on => { on ? yt.show() : yt.close(); };

// ── 뽀모도로 창 ──
const pomo = createPomodoro({
  getState: () => state, saveState,
  preload: path.join(__dirname, 'preload.js'),
  onVisibilityChange: () => notifyRenderers(),
});
const setPomodoro = on => { on ? pomo.show() : pomo.close(); };

let tray, quitting = false;
function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: mode === 'desktop' ? '일정 편집하기 (Ctrl+Alt+C)' : '바탕화면에 고정하기 (Ctrl+Alt+C)', click: toggleMode },
    { label: '메모 창 보이기', type: 'checkbox', checked: state.memoVisible !== false, click: (i) => setMemoVisible(i.checked) },
    { label: '뽀모도로 타이머', type: 'checkbox', checked: pomo.visible(), click: (i) => setPomodoro(i.checked) },
    { label: '유튜브 창', type: 'checkbox', checked: yt.visible(), click: (i) => setYoutube(i.checked) },
    { label: '캐릭터 보이기', type: 'checkbox', checked: state.petVisible !== false, click: (i) => setPet({ visible: i.checked }) },
    { label: '달력 위치·크기 잠금', type: 'checkbox', checked: !!state.locked, click: (i) => setLocked(i.checked) },
    { label: '메모 위치·크기 잠금', type: 'checkbox', checked: !!state.memoLocked, click: (i) => setMemoLocked(i.checked) },
    { label: '컴퓨터 켤 때 자동 실행', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: `업데이트 확인 (현재 ${app.getVersion()})`, click: () => checkForUpdates(true) },
    { label: '종료', click: () => app.quit() },
  ]));
}

// ── 자동 업데이트 ─────────────────────────────────────────────
// GitHub Releases 에 새 버전이 올라오면 "업데이트 하시겠습니까?" 를 묻고,
// "예" 를 누르면 내려받아 설치한 뒤 다시 실행한다. (설치판에서만 동작)
let autoUpdater = null;
let updateBusy = false;
function setupUpdater() {
  if (!app.isPackaged) return;
  try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { console.error(e); return; }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-available', async (info) => {
    const r = await dialog.showMessageBox({
      type: 'info', title: '바탕화면 캘린더 업데이트',
      message: `새로운 버전(${info.version})이 있습니다.\n업데이트 하시겠습니까?`,
      detail: `현재 버전: ${app.getVersion()}`,
      buttons: ['예', '아니요'], defaultId: 0, cancelId: 1, noLink: true,
    });
    if (r.response === 0) {
      tray && tray.setToolTip('바탕화면 캘린더 - 업데이트 내려받는 중...');
      autoUpdater.downloadUpdate().catch(err => { updateBusy = false; showUpdateError(err); });
    } else {
      updateBusy = false;
    }
  });
  autoUpdater.on('update-downloaded', () => {
    quitting = true;
    allWindows().forEach(unembed);
    autoUpdater.quitAndInstall(true, true);
  });
  autoUpdater.on('error', (err) => { if (updateBusy === 'manual') showUpdateError(err); updateBusy = false; });
  setTimeout(() => checkForUpdates(false), 8000);
  setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000);
}
function checkForUpdates(manual) {
  if (!autoUpdater) {
    if (manual) dialog.showMessageBox({ type: 'info', message: '설치판(Setup)으로 설치한 경우에만 자동 업데이트를 쓸 수 있습니다.', buttons: ['확인'] });
    return;
  }
  if (updateBusy) return;
  updateBusy = manual ? 'manual' : true;
  autoUpdater.checkForUpdates().then(r => {
    const newer = r && r.updateInfo && r.updateInfo.version !== app.getVersion();
    if (!newer) {
      updateBusy = false;
      if (manual) dialog.showMessageBox({ type: 'info', message: `최신 버전(${app.getVersion()})을 사용 중입니다.`, buttons: ['확인'] });
    }
  }).catch(err => { if (manual) showUpdateError(err); updateBusy = false; });
}
function showUpdateError(err) {
  dialog.showMessageBox({ type: 'warning', message: '업데이트를 확인하지 못했습니다.', detail: String(err && err.message || err).slice(0, 300), buttons: ['확인'] });
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => managed.main && enterEditMode());

function createWindows() {
  const wa = screen.getPrimaryDisplay().workArea;
  const main = makeWindow('main', 'index.html', { width: 1000, height: 700, minWidth: 640, minHeight: 460 });
  makeWindow('memo', 'memo.html', {
    width: 320, height: 380, minWidth: 220, minHeight: 220,
    x: wa.x + wa.width - 340, y: wa.y + 20, show: state.memoVisible !== false,
  });

  main.win.on('focus', () => setTimeout(keepMemoAbove, 30));
  const memo = managed.memo;
  memo.win.on('blur', () => { if (mode === 'desktop') setTimeout(sinkToBottom, 30); });

  let started = false;
  main.win.webContents.on('did-finish-load', () => {
    if (started) return; started = true;
    if (state.mode !== 'edit') setTimeout(enterDesktopMode, 500);
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
  setupUpdater();
  pet.apply();
  yt.restoreIfWasOpen();   // 지난번에 유튜브 창을 열어 둔 채 껐으면 다시 연다
}

ipcMain.handle('get-autostart', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('set-autostart', (_e, on) => { app.setLoginItemSettings({ openAtLogin: !!on }); buildTrayMenu(); });
ipcMain.on('set-locked', (_e, on) => setLocked(on));
ipcMain.on('set-memo-locked', (_e, on) => setMemoLocked(on));
ipcMain.on('desktop-mode', () => enterDesktopMode());
ipcMain.on('set-memo-visible', (_e, on) => setMemoVisible(on));
ipcMain.on('check-update', () => checkForUpdates(true));
// 초기화: 창 위치·크기·잠금·모드를 처음 상태로 되돌리고 두 창을 다시 불러온다 (지울 저장 내용은 화면 쪽에서 먼저 지움)
ipcMain.on('reset', () => {
  if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
  allWindows().forEach(unembed);
  pet.defaultImage();
  state = { seenHint: true, mode: 'edit' }; saveState();
  pet.apply();
  mode = 'edit';
  const wa = screen.getPrimaryDisplay().workArea;
  const main = mainWin(), memo = memoWin();
  [main, memo].forEach(w => { if (w) { w.setMovable(true); w.setResizable(true); } });
  if (main) main.setBounds({ x: wa.x + Math.round((wa.width - 1000) / 2), y: wa.y + Math.round((wa.height - 700) / 2), width: 1000, height: 700 });
  if (memo) { memo.setBounds({ x: wa.x + wa.width - 340, y: wa.y + 20, width: 320, height: 380 }); memo.show(); }
  allWindows().forEach(m => m.win.webContents.reload());
  if (main) main.focus();
  setTimeout(keepMemoAbove, 300);
});
ipcMain.on('pomo-visible', (_e, on) => setPomodoro(on));
ipcMain.on('pomo-action', (_e, name) => pomo.action(name));
ipcMain.on('yt-visible', (_e, on) => setYoutube(on));
ipcMain.on('yt-action', (_e, name, arg) => yt.action(name, arg));
ipcMain.on('pet-set', (_e, o) => setPet(o || {}));
ipcMain.handle('pet-pick-image', async () => { const ok = await pet.pickImage(mainWin()); notifyRenderers(); return ok; });
ipcMain.on('pet-default-image', () => { pet.defaultImage(); notifyRenderers(); });
ipcMain.on('pet-mouse', (_e, over) => pet.onMouse(over));
ipcMain.on('pet-drag', (_e, on, click) => pet.onDrag(on, click));
ipcMain.on('pet-double', () => pet.onDoubleClick());
ipcMain.on('notify', (_e, title, body) => new Notification({ title, body }).show());
ipcMain.on('quit', () => app.quit());

app.whenReady().then(createWindows);
app.on('before-quit', () => {
  quitting = true;
  pet.hide();
  // 종료 전에 바탕화면에서 떼어내야 창이 깔끔하게 닫힌다
  allWindows().forEach(unembed);
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
