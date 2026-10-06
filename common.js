// 달력 창과 메모 창이 함께 쓰는 도구들
const $ = id => document.getElementById(id);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const hexRgb = h => [1,3,5].map(i => parseInt(h.slice(i, i+2), 16));
const isLight = h => { const [r,g,b] = hexRgb(h); return (r*299 + g*587 + b*114) / 1000 > 150; };

// 일정·메모는 지우면 "지움 표시(deleted)"를 남기고, 마지막으로 바뀐 시각 u(밀리초)를 가진다.
const live = list => list.filter(x => !x.deleted);
const touch = x => { x.u = Date.now(); return x; };

// 색상 동그라미 + 직접 고르기 (+ 자동)
function swatches(id, list, current, onPick, withAuto) {
  const box = $(id); box.innerHTML = '';
  if (withAuto) {
    const a = document.createElement('div');
    a.className = 'sw sw-auto' + (current === 'auto' ? ' on' : ''); a.textContent = '자동';
    a.onclick = () => onPick('auto'); box.append(a);
  }
  list.forEach(c => {
    const d = document.createElement('div');
    d.className = 'sw' + (c.toLowerCase() === String(current).toLowerCase() ? ' on' : '');
    d.style.background = c; d.title = c;
    d.onclick = () => onPick(c);
    box.append(d);
  });
  const custom = document.createElement('input');
  custom.type = 'color'; custom.value = current === 'auto' ? '#ffffff' : current; custom.title = '직접 고르기';
  custom.onchange = e => onPick(e.target.value);
  box.append(custom);
}

// 입력칸으로 바꿔서 고치기: Enter/바깥 클릭 = 저장, Esc = 취소
function inlineEdit(el, value, { maxLength = 100, placeholder = '', onDone }) {
  if (el.querySelector('input')) return;
  const inp = document.createElement('input');
  inp.className = 'edit'; inp.value = value; inp.maxLength = maxLength; inp.placeholder = placeholder;
  el.textContent = ''; el.append(inp); inp.focus(); inp.select();
  let done = false;
  const finish = ok => { if (done) return; done = true; onDone(ok ? inp.value.trim() : null); };
  inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
  inp.onblur = () => finish(true);
}

// 테마(배경·글자색 등)를 CSS 변수로 적용
function applyTheme(cfg) {
  const s = document.documentElement.style;
  // 자동: 배경이 밝고 충분히 불투명할 때만 어두운 글자, 그 외(어두운 배경, 많이 비칠 때)는 밝은 글자
  const fg = cfg.fg === 'auto' ? (isLight(cfg.bg) && cfg.opacity >= 60 ? '#1B2A41' : '#F6F4EE') : cfg.fg;
  const lightText = isLight(fg);
  s.setProperty('--base', hexRgb(cfg.bg).join(','));
  s.setProperty('--alpha', cfg.opacity / 100);
  s.setProperty('--accent', cfg.accent);
  s.setProperty('--fg', fg);
  s.setProperty('--sun', lightText ? '#FF9B8A' : '#C62828');
  s.setProperty('--sat', lightText ? '#8FC1FF' : '#1E5BB8');
  s.setProperty('--ts', !cfg.shadow ? 'none' : lightText
    ? '0 0 3px rgba(0,0,0,.95), 0 1px 2px rgba(0,0,0,.9)'
    : '0 0 3px rgba(255,255,255,.95), 0 1px 2px rgba(255,255,255,.9)');
}
const BG_COLORS = ['#1B2A41','#22252B','#2E3B2F','#3B2433','#1F3A4D','#F3EFE6','#FFFFFF'];
const AC_COLORS = ['#F2A65A','#FF8A80','#FFD166','#8BD3A0','#7FC8F8','#B69CFF'];
const loadCfg = () => Object.assign({ opacity: 85, mon: false, bg: BG_COLORS[0], fg: 'auto', shadow: true, accent: AC_COLORS[0], evColor: '#F2A65A' }, load('cfg', {}));
