// ── 바탕화면 캐릭터 (shimeji 처럼 화면을 돌아다니는 캐릭터) ─────────────
// 투명한 작은 창 하나에 캐릭터를 그리고, 그 창을 화면 위에서 움직인다.
// 걷기 · 앉아 쉬기 · 잠자기 · 벽 타기 · 떨어지기, 마우스로 잡아서 던지기, 클릭하면 점프하며 오늘 일정 말하기.
const { BrowserWindow, screen, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const TICK = 33;            // 약 30fps
const GRAVITY = 0.7;

function createPet({ getState, saveState, preload, onDoubleClick }) {
  let win = null, timer = null;
  const p = { x: 0, y: 0, vx: 0, vy: 0, dir: 1, side: null, state: 'fall', until: 0, offX: 0, offY: 0, hist: [] };

  const st = () => getState();
  const size = () => Math.min(220, Math.max(48, st().petSize || 96));
  // 창은 캐릭터보다 넓고 높게: 위쪽에 말풍선 자리
  const dims = () => ({ W: Math.max(size() + 40, 210), H: size() + 80 });

  function config() {
    const img = st().petImage;
    return {
      size: size(),
      image: img && fs.existsSync(img) ? pathToFileURL(img).href + '?v=' + (st().petImageV || 0) : null,
    };
  }
  const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

  function setState(name, ms = 0) {
    p.state = name; p.until = Date.now() + ms;
    send('pet-state', { state: name, dir: p.dir, side: p.side });
  }
  const rand = (a, b) => a + Math.random() * (b - a);

  // 쉬고 난 다음 할 일 고르기
  function nextAction() {
    const r = Math.random();
    if (r < 0.65) { p.dir = Math.random() < 0.5 ? -1 : 1; setState('walk', rand(3000, 9000)); }
    else if (r < 0.88) setState('idle', rand(2000, 5000));
    else setState('sleep', rand(8000, 16000));
  }

  function tick() {
    if (!win || win.isDestroyed()) return;
    const s = size();
    const disp = screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y - s / 2) });
    const wa = disp.workArea;
    const half = s * 0.4, floor = wa.y + wa.height, top = wa.y + s;
    const left = wa.x + half, right = wa.x + wa.width - half;
    const now = Date.now();
    const speed = Math.max(1.2, s / 55);

    switch (p.state) {
      case 'drag': {
        const c = screen.getCursorScreenPoint();
        p.x = c.x + p.offX; p.y = c.y + p.offY;
        p.hist.push({ x: p.x, y: p.y, t: now }); if (p.hist.length > 5) p.hist.shift();
        break;
      }
      case 'walk':
        p.x += p.dir * speed;
        if (p.x <= left || p.x >= right) {
          p.x = Math.min(right, Math.max(left, p.x));
          if (Math.random() < 0.35) { p.side = p.x <= left ? 'left' : 'right'; setState('climb', rand(4000, 12000)); }
          else { p.dir *= -1; send('pet-state', { state: 'walk', dir: p.dir }); }
        } else if (now > p.until) setState('idle', rand(1500, 4000));
        break;
      case 'climb':
        p.y -= speed * 0.7;
        if (p.y <= top || now > p.until) {
          // 벽에서 손을 놓고 떨어진다 (벽 반대쪽으로 살짝)
          p.vx = p.side === 'left' ? rand(1, 3) : -rand(1, 3); p.vy = 0; p.side = null;
          p.dir = p.vx > 0 ? 1 : -1;
          setState('fall');
        }
        break;
      case 'fall':
        p.vy = Math.min(p.vy + GRAVITY, 28);
        p.y += p.vy; p.x += p.vx; p.vx *= 0.99;
        if (p.x < left) { p.x = left; p.vx = Math.abs(p.vx) * 0.5; }
        if (p.x > right) { p.x = right; p.vx = -Math.abs(p.vx) * 0.5; }
        if (p.y < top - s) p.y = top - s;
        if (p.y >= floor) { p.y = floor; p.vx = 0; p.vy = 0; setState('land', 450); }
        break;
      case 'land':
        if (now > p.until) setState('idle', rand(800, 2000));
        break;
      case 'idle': case 'sleep':
        if (p.y < floor - 1) { p.vy = 0; p.vx = 0; setState('fall'); break; }
        p.y = floor;
        if (now > p.until) nextAction();
        break;
    }
    // 화면이 바뀌어(해상도 등) 바닥 아래로 내려가 있으면 바닥에 세운다
    if (p.state !== 'drag' && p.y > floor) p.y = floor;

    const { W, H } = dims();
    const nx = Math.round(p.x - W / 2), ny = Math.round(p.y - H);
    const [cx, cy] = win.getPosition();
    if (cx !== nx || cy !== ny) win.setPosition(nx, ny);
  }

  function show() {
    if (win && !win.isDestroyed()) return;
    const { W, H } = dims();
    const wa = screen.getPrimaryDisplay().workArea;
    p.x = rand(wa.x + wa.width * 0.2, wa.x + wa.width * 0.8);
    p.y = wa.y + size() + 10; p.vx = 0; p.vy = 0;
    win = new BrowserWindow({
      width: W, height: H, x: Math.round(p.x - W / 2), y: Math.round(p.y - H),
      frame: false, transparent: true, resizable: false, movable: false,
      skipTaskbar: true, hasShadow: false, focusable: false,
      minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true,
      webPreferences: { preload },
    });
    win.setAlwaysOnTop(true, 'floating');
    win.setIgnoreMouseEvents(true, { forward: true });   // 캐릭터가 아닌 투명한 부분은 클릭이 뒤로 통과
    win.setMenu(null);
    win.loadFile(path.join(__dirname, 'pet.html'));
    win.webContents.on('did-finish-load', () => { send('pet-config', config()); setState('fall'); });
    timer = setInterval(tick, TICK);
  }

  function hide() {
    if (timer) { clearInterval(timer); timer = null; }
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
  }

  function apply() {
    if (st().petVisible === false) { hide(); return; }
    if (!win || win.isDestroyed()) { show(); return; }
    const { W, H } = dims();
    win.setBounds({ x: Math.round(p.x - W / 2), y: Math.round(p.y - H), width: W, height: H });
    send('pet-config', config());
  }

  async function pickImage(parent) {
    const r = await dialog.showOpenDialog(parent, {
      title: '캐릭터로 쓸 그림 고르기',
      filters: [{ name: '그림 (움직이는 GIF 도 됩니다)', extensions: ['png', 'gif', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return false;
    const src = r.filePaths[0];
    const dest = path.join(app.getPath('userData'), 'pet-image' + path.extname(src).toLowerCase());
    // 원본이 지워져도 계속 쓰도록 앱 폴더에 복사해 둔다
    const old = st().petImage;
    if (old && old !== dest && fs.existsSync(old)) { try { fs.unlinkSync(old); } catch {} }
    fs.copyFileSync(src, dest);
    const s = st(); s.petImage = dest; s.petImageV = Date.now(); saveState();
    apply();
    return true;
  }

  function defaultImage() {
    const s = st();
    if (s.petImage && fs.existsSync(s.petImage)) { try { fs.unlinkSync(s.petImage); } catch {} }
    delete s.petImage; saveState();
    apply();
  }

  // 캐릭터 창에서 오는 신호
  function onMouse(over) {
    if (!win || win.isDestroyed()) return;
    if (over) win.setIgnoreMouseEvents(false);
    else if (p.state !== 'drag') win.setIgnoreMouseEvents(true, { forward: true });
  }
  function onDrag(on, click) {
    if (!win || win.isDestroyed()) return;
    if (on) {
      const c = screen.getCursorScreenPoint();
      p.offX = p.x - c.x; p.offY = p.y - c.y; p.hist = []; p.side = null;
      win.setIgnoreMouseEvents(false);
      setState('drag');
      return;
    }
    if (p.state !== 'drag') return;
    if (click) { p.vx = 0; p.vy = -10; }                // 클릭: 깡충
    else {                                            // 놓기: 끌던 속도로 던져진다
      const h = p.hist, a = h[0], b = h[h.length - 1];
      const dt = a && b && b.t > a.t ? (b.t - a.t) / TICK : 1;
      p.vx = a && b ? Math.max(-18, Math.min(18, (b.x - a.x) / dt)) : 0;
      p.vy = a && b ? Math.max(-18, Math.min(18, (b.y - a.y) / dt)) : 0;
    }
    if (p.vx) p.dir = p.vx > 0 ? 1 : -1;
    setState('fall');
  }

  return {
    apply, hide, pickImage, defaultImage, onMouse, onDrag,
    onDoubleClick: () => onDoubleClick && onDoubleClick(),
    get win() { return win; },
  };
}

module.exports = { createPet };
