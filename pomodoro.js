// ── 뽀모도로 창 ──────────────────────────────────────────────
// 유튜브 창처럼 따로 뜨는 작은 창. 작업 표시줄에는 버튼을 만들지 않는다.
// 끝낸 집중 기록은 창 안(pomodoro.html)에서 localStorage 'pomoLog' 에 저장 → 달력의 "뽀모도로 달력"에 표시된다.
const { BrowserWindow, screen } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 표지에 넣은 유튜브 영상: 파일(file://)로 연 창 안에 유튜브를 바로 넣으면 "어느 사이트에서 틀었는지"가 없어서
// 유튜브가 '오류 153'으로 막는다. 그래서 이 컴퓨터 안에서만 열리는 작은 주소(http://127.0.0.1:포트)로
// yt-cover.html 을 띄우고, 그 안에서 유튜브를 재생한다. (바깥에서는 접속할 수 없다)
let coverServer = null;
function coverPort() {
  if (coverServer) return coverServer;
  coverServer = new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      if (req.method !== 'GET' || req.url.split('?')[0] !== '/yt-cover.html') { res.writeHead(404); res.end(); return; }
      fs.readFile(path.join(__dirname, 'yt-cover.html'), (err, buf) => {
        if (err) { res.writeHead(500); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(buf);
      });
    });
    srv.on('error', () => resolve(0));
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
  return coverServer;
}

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
      // 창이 가려져도 타이머가 느려지지 않게, 클릭 없이 끝나는 순간에도 소리가 나게
      webPreferences: { preload, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    win.setMenu(null);
    const w = win;
    coverPort().then(port => { if (!w.isDestroyed()) w.loadFile(path.join(__dirname, 'pomodoro.html'), { query: { ytPort: String(port) } }); });
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
