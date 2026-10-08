// ── 뽀모도로 창 ──────────────────────────────────────────────
// 유튜브 창처럼 따로 뜨는 작은 창. 작업 표시줄에는 버튼을 만들지 않는다.
// 끝낸 집중 기록은 창 안(pomodoro.html)에서 localStorage 'pomoLog' 에 저장 → 달력의 "뽀모도로 달력"에 표시된다.
const { BrowserWindow, screen } = require('electron');
const path = require('path');

function createPomodoro({ getState, saveState, preload, onVisibilityChange }) {
  let win = null;
  const st = () => getState();
  const remember = part => { const s = st(); s.pomo = Object.assign({}, s.pomo, part); saveState(); };

  function show() {
    if (win) { win.show(); win.focus(); return; }
    const s = st().pomo || {};
    const wa = screen.getPrimaryDisplay().workArea;
    const b = s.bounds || { x: wa.x + wa.width - 380, y: wa.y + Math.max(0, wa.height - 600), width: 360, height: 580 };
    win = new BrowserWindow({
      x: b.x, y: b.y, width: 360, height: 580, resizable: false,
      frame: false, transparent: true, hasShadow: false, skipTaskbar: true,
      alwaysOnTop: !!s.onTop, minimizable: false, maximizable: false, fullscreenable: false,
      title: '뽀모도로', icon: path.join(__dirname, 'icon.png'),
      webPreferences: { preload, backgroundThrottling: false },   // 창이 가려져도 타이머가 느려지지 않게
    });
    win.setMenu(null);
    win.loadFile(path.join(__dirname, 'pomodoro.html'));
    win.webContents.on('did-finish-load', () => win && win.webContents.send('pomo-state', { onTop: !!s.onTop }));
    win.on('moved', () => remember({ bounds: win.getBounds() }));
    win.on('closed', () => { win = null; remember({ visible: false }); onVisibilityChange && onVisibilityChange(); });
    remember({ visible: true }); onVisibilityChange && onVisibilityChange();
  }
  function close() { if (win) win.close(); }
  function action(name) {
    if (!win) return;
    if (name === 'close') close();
    if (name === 'top') { const on = !win.isAlwaysOnTop(); win.setAlwaysOnTop(on); remember({ onTop: on }); win.webContents.send('pomo-state', { onTop: on }); }
  }
  return { show, close, action, visible: () => !!win, get win() { return win; } };
}

module.exports = { createPomodoro };
