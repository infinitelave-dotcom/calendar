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

  const packDir = () => path.join(app.getPath('userData'), 'pet-pack');

  function config() {
    const s = st(), v = '?v=' + (s.petImageV || 0);
    const pack = s.petPack;
    if (pack && fs.existsSync(packDir())) {
      const url = f => pathToFileURL(path.join(packDir(), f)).href + v;
      if (pack.kind === 'shimeji') {
        // shimeji 그림 번호 → 동작 (shimeji 표준 번호 규칙)
        const have = new Set(pack.files);
        const pick = (nums, fb) => { const l = nums.filter(n => have.has(`shime${n}.png`)); return (l.length ? l : fb).map(n => url(`shime${n}.png`)); };
        const base = [have.has('shime1.png') ? 1 : parseInt(pack.files[0].slice(5))];
        return { size: size(), kind: 'shimeji', frames: {
          walk: pick([1, 2, 1, 3], base), idle: pick([11], base), sleep: pick([21], have.has('shime11.png') ? [11] : base),
          fall: pick([4], base), land: pick([18, 19], base), drag: pick([5, 6, 5, 7], base), climb: pick([12, 13, 14, 13], base),
        } };
      }
      // 일반 그림 여러 장: 걷기·벽타기·잡힘은 순서대로 넘기고, 나머지는 첫 장
      const all = pack.files.map(url), first = [all[0]];
      return { size: size(), kind: 'frames', frames: { walk: all, climb: all, drag: all, idle: first, sleep: first, fall: first, land: first } };
    }
    const img = s.petImage;
    return { size: size(), image: img && fs.existsSync(img) ? pathToFileURL(img).href + v : null };
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
      filters: [{ name: '그림 또는 shimeji zip', extensions: ['png', 'gif', 'jpg', 'jpeg', 'webp', 'zip'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return false;
    const src = r.filePaths[0];
    if (path.extname(src).toLowerCase() === '.zip') {
      try { loadZip(src); }
      catch (e) { dialog.showMessageBox(parent, { type: 'warning', message: 'zip 파일을 캐릭터로 쓸 수 없습니다.', detail: String(e.message || e), buttons: ['확인'] }); return false; }
      apply();
      return true;
    }
    clearPack();
    const dest = path.join(app.getPath('userData'), 'pet-image' + path.extname(src).toLowerCase());
    // 원본이 지워져도 계속 쓰도록 앱 폴더에 복사해 둔다
    const old = st().petImage;
    if (old && old !== dest && fs.existsSync(old)) { try { fs.unlinkSync(old); } catch {} }
    fs.copyFileSync(src, dest);
    const s = st(); s.petImage = dest; s.petImageV = Date.now(); saveState();
    apply();
    return true;
  }

  // ── zip 캐릭터 ──
  // shimeji 묶음(img/…/shime1.png ~ shime46.png)이면 동작별 그림을 쓰고,
  // 그 밖의 그림 여러 장이 든 zip 이면 이름 순서대로 넘기며 움직인다.
  // zip 안의 경로는 쓰지 않고 우리가 정한 이름으로만 저장한다(엉뚱한 폴더에 풀리지 않게).
  const IMG = /\.(png|gif|jpe?g|webp)$/i;
  function loadZip(src) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(src);
    const entries = zip.getEntries().filter(e => !e.isDirectory && IMG.test(e.entryName) && !/(^|\/)(__MACOSX|\.)/.test(e.entryName));
    if (!entries.length) throw new Error('zip 안에 그림 파일(png, gif, jpg, webp)이 없습니다.');
    if (entries.length > 400) throw new Error('그림이 너무 많습니다 (400장까지).');
    let total = 0;
    for (const e of entries) {
      if (e.header.size > 10 * 1024 * 1024) throw new Error(`${path.basename(e.entryName)} 파일이 너무 큽니다 (한 장에 10MB까지).`);
      total += e.header.size;
    }
    if (total > 150 * 1024 * 1024) throw new Error('그림 전체 크기가 너무 큽니다 (150MB까지).');

    // shimeji 그림이 들어 있는 폴더 찾기 (여러 캐릭터가 들어 있으면 그림이 가장 많은 첫 폴더)
    const groups = new Map();
    for (const e of entries) {
      const m = /(?:^|\/)shime(\d+)\.png$/i.exec(e.entryName);
      if (!m) continue;
      const dir = path.posix.dirname(e.entryName);
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push({ e, n: +m[1] });
    }
    const out = packDir();
    const write = list => {
      fs.rmSync(out, { recursive: true, force: true });
      fs.mkdirSync(out, { recursive: true });
      list.forEach(({ e, name }) => fs.writeFileSync(path.join(out, name), e.getData()));
    };
    let pack;
    if (groups.size) {
      const [, best] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
      const list = best.map(({ e, n }) => ({ e, name: `shime${n}.png` }));
      write(list);
      pack = { kind: 'shimeji', files: list.map(x => x.name) };
    } else {
      const sorted = entries.slice().sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
      const list = sorted.map((e, i) => ({ e, name: `f${String(i).padStart(3, '0')}${path.extname(e.entryName).toLowerCase()}` }));
      write(list);
      pack = { kind: 'frames', files: list.map(x => x.name) };
    }
    const s = st();
    if (s.petImage && fs.existsSync(s.petImage)) { try { fs.unlinkSync(s.petImage); } catch {} }
    delete s.petImage;
    s.petPack = pack; s.petImageV = Date.now(); saveState();
    return pack;
  }
  function clearPack() {
    fs.rmSync(packDir(), { recursive: true, force: true });
    delete st().petPack;
  }

  function defaultImage() {
    clearPack();
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
    loadZip: (src) => { const r = loadZip(src); apply(); return r; },
  };
}

module.exports = { createPet };
