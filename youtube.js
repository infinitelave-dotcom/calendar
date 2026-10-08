// ── 작은 유튜브 창 ─────────────────────────────────────────────
// 메모 창처럼 작은 창에 유튜브를 띄운다. 위쪽 띠(youtube.html)는 우리 화면이고,
// 그 아래 유튜브 페이지는 따로 분리된 WebContentsView 에 띄운다 (앱 기능에 손대지 못하게).
// 최소화하면 작업 표시줄로 내려가고, 작업 표시줄 아이콘에 마우스를 올리면
// 음악 앱처럼 ⏮ ⏯ ⏭ 버튼이 미리보기 아래에 나온다 (윈도우 전용).
const { BrowserWindow, WebContentsView, nativeImage, screen, shell, app } = require('electron');
const path = require('path');

const BAR = 34;                                   // 위쪽 띠 높이
const HOME = process.env.DC_YT_HOME || 'https://www.youtube.com/';
const isYouTube = u => { try { const h = new URL(u).hostname; return /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)google\.com$|(^|\.)gstatic\.com$/.test(h); } catch { return false; } };

function createYouTube({ getState, saveState, preload, onVisibilityChange }) {
  let win = null, view = null, poll = null, dragTimer = null;
  let media = { playing: false, title: '', has: false };
  const st = () => getState();
  const icon = n => nativeImage.createFromPath(path.join(__dirname, `yt-${n}.png`));

  function layout() {
    if (!win || !view) return;
    const [w, h] = win.getContentSize();
    view.setBounds({ x: 0, y: BAR, width: w, height: Math.max(0, h - BAR) });
  }

  // 유튜브 페이지 안의 동영상 조작 (페이지에 있는 버튼을 눌러 주는 방식)
  const run = js => view && !view.webContents.isDestroyed() ? view.webContents.executeJavaScript(js, true).catch(() => null) : Promise.resolve(null);
  const control = {
    toggle: () => run(`(() => { const v = document.querySelector('video'); if (!v) return; v.paused ? v.play() : v.pause(); })()`),
    next: () => run(`(() => { const b = document.querySelector('.ytp-next-button'); if (b && b.offsetParent !== null) { b.click(); return; }
                          const v = document.querySelector('video'); if (v) v.currentTime = v.duration; })()`),
    prev: () => run(`(() => { const v = document.querySelector('video');
                          if (v && v.currentTime > 3) { v.currentTime = 0; return; }   // 3초 넘게 들었으면 처음으로
                          const b = document.querySelector('.ytp-prev-button'); if (b && b.offsetParent !== null) b.click(); else history.back(); })()`),
  };

  // 작업 표시줄 미리보기의 ⏮ ⏯ ⏭ 버튼
  function updateThumbar() {
    if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
    win.setThumbarButtons([
      { tooltip: '이전', icon: icon('prev'), click: () => control.prev(), flags: media.has ? [] : ['disabled'] },
      { tooltip: media.playing ? '일시정지' : '재생', icon: icon(media.playing ? 'pause' : 'play'), click: () => control.toggle(), flags: media.has ? [] : ['disabled'] },
      { tooltip: '다음', icon: icon('next'), click: () => control.next(), flags: media.has ? [] : ['disabled'] },
    ]);
  }

  // 1초마다 재생 상태와 제목을 확인해서 버튼 모양·창 제목을 맞춘다
  async function check() {
    const r = await run(`(() => { const v = document.querySelector('video');
      const t = (document.querySelector('#title h1, h1.ytd-watch-metadata, .slim-video-metadata-header h2') || {}).textContent || document.title;
      return { has: !!v && !!(v.currentSrc || v.src || v.srcObject), playing: !!v && !v.paused && !v.ended, title: (t || '').trim().replace(/ - YouTube$/, '') }; })()`);
    if (!r) return;
    const changed = r.playing !== media.playing || r.has !== media.has || r.title !== media.title;
    media = r;
    if (changed) {
      updateThumbar();
      const t = (media.playing ? '▶ ' : '') + (media.title || '유튜브');
      win.setTitle(t);
      win.webContents.send('yt-state', { title: media.title, playing: media.playing, canBack: view.webContents.navigationHistory.canGoBack() });
    }
  }

  function create() {
    const s = st().yt || {};
    const wa = screen.getPrimaryDisplay().workArea;
    const b = s.bounds || { width: 420, height: 300, x: wa.x + wa.width - 440, y: wa.y + wa.height - 320 };
    win = new BrowserWindow({
      ...b, minWidth: 260, minHeight: 180,
      frame: false, backgroundColor: '#0F0F0F', title: '유튜브',
      skipTaskbar: false,                       // 작업 표시줄에 보여야 최소화·음악 버튼이 된다
      alwaysOnTop: !!s.onTop, minimizable: true, maximizable: false, fullscreenable: true,
      icon: path.join(__dirname, 'icon.png'),
      webPreferences: { preload },
    });
    win.setMenu(null);
    win.loadFile(path.join(__dirname, 'youtube.html'));

    view = new WebContentsView({
      webPreferences: { partition: 'persist:youtube', backgroundThrottling: false, sandbox: true, contextIsolation: true },
    });
    win.contentView.addChildView(view);
    // "Electron" 이 들어간 브라우저 이름이면 유튜브·구글 로그인이 막힐 수 있어 일반 크롬 이름으로
    view.webContents.setUserAgent(app.userAgentFallback.replace(/ Electron\/\S+/, '').replace(/ desktop-calendar\/\S+/, ''));
    // 유튜브 밖의 링크는 평소 쓰는 브라우저로 연다
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isYouTube(url)) view.webContents.loadURL(url); else if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    view.webContents.on('will-navigate', (e, url) => { if (!isYouTube(url) && !url.startsWith('file:') && !url.startsWith('data:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
    const navigated = (_e, url) => {
      remember({ url });
      if (win && !win.isDestroyed()) win.webContents.send('yt-state', { canBack: view.webContents.navigationHistory.canGoBack() });
    };
    view.webContents.on('did-navigate-in-page', navigated);
    view.webContents.on('did-navigate', navigated);
    // 동영상 전체 화면 버튼 → 창 전체 화면
    view.webContents.on('enter-html-full-screen', () => { win.setFullScreen(true); });
    view.webContents.on('leave-html-full-screen', () => { win.setFullScreen(false); });
    view.webContents.loadURL(s.url && isYouTube(s.url) ? s.url : HOME);

    layout();
    win.on('resize', layout);
    win.on('enter-full-screen', () => { const [w, h] = win.getContentSize(); view.setBounds({ x: 0, y: 0, width: w, height: h }); });
    win.on('leave-full-screen', layout);
    // 옮기거나 크기를 바꾸면 0.4초 뒤에 저장 (다음에 열 때 같은 자리·크기)
    let saveT = null;
    const saveBounds = () => { clearTimeout(saveT); saveT = setTimeout(() => {
      if (win && !win.isDestroyed() && !win.isMinimized() && !win.isFullScreen()) remember({ bounds: win.getBounds() }); }, 400); };
    win.on('move', saveBounds); win.on('resize', saveBounds);
    win.on('show', updateThumbar);
    win.on('restore', updateThumbar);
    win.on('close', () => { remember({ visible: false }); onVisibilityChange && onVisibilityChange(); });
    win.on('closed', () => { clearInterval(poll); poll = null; win = null; view = null; });
    win.webContents.on('did-finish-load', () => { win.webContents.send('yt-state', { title: media.title, playing: media.playing, onTop: !!s.onTop }); updateThumbar(); });
    poll = setInterval(check, 1000);
  }

  function remember(part) {
    const s = st(); s.yt = Object.assign({}, s.yt, part); saveState();
  }

  function show() {
    if (!win) create(); else { if (win.isMinimized()) win.restore(); win.show(); }
    win.focus();
    remember({ visible: true }); onVisibilityChange && onVisibilityChange();
  }
  // 닫기(✕): 창을 없애서 소리도 멈춘다
  function close() {
    if (win) { const w = win; win = null; w.destroy(); }
    remember({ visible: false }); onVisibilityChange && onVisibilityChange();
  }
  const visible = () => !!win;

  // 위쪽 띠의 버튼들
  function action(name, arg) {
    if (!win) return;
    const wc = view.webContents;
    switch (name) {
      case 'min': win.minimize(); break;
      case 'close': close(); break;
      case 'home': wc.loadURL(HOME); break;
      case 'back': if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
      case 'top': { const on = !win.isAlwaysOnTop(); win.setAlwaysOnTop(on); remember({ onTop: on }); win.webContents.send('yt-state', { onTop: on }); break; }
      case 'search': {
        const q = String(arg || '').trim(); if (!q) break;
        // 유튜브 주소를 붙여넣으면 그 주소로, 아니면 검색
        if (/^https?:\/\//.test(q) && isYouTube(q)) wc.loadURL(q);
        else wc.loadURL('https://www.youtube.com/results?search_query=' + encodeURIComponent(q));
        break;
      }
      case 'dragStart': {
        // 마우스를 따라 창 옮기기 (잡은 위치 그대로 유지)
        if (win.isFullScreen()) break;
        const c = screen.getCursorScreenPoint(), [wx, wy] = win.getPosition(), [ww, wh] = win.getSize();
        const off = { x: c.x - wx, y: c.y - wy };
        clearInterval(dragTimer);
        dragTimer = setInterval(() => {
          if (!win || win.isDestroyed()) { clearInterval(dragTimer); return; }
          const p = screen.getCursorScreenPoint();
          win.setBounds({ x: p.x - off.x, y: p.y - off.y, width: ww, height: wh });
        }, 16);
        break;
      }
      case 'dragEnd': clearInterval(dragTimer); dragTimer = null; break;
      case 'toggle': control.toggle(); break;
      case 'next': control.next(); break;
      case 'prev': control.prev(); break;
    }
  }

  return { show, close, visible, action, restoreIfWasOpen: () => { if (st().yt && st().yt.visible) show(); },
           get win() { return win; }, get view() { return view; } };
}

module.exports = { createYouTube };
