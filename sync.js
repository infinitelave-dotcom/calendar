// ── 집·회사 연동 (Firebase) ────────────────────────────────────
// 아이디/비밀번호로 로그인하면 일정과 메모를 Firebase 에 저장하고,
// 다른 컴퓨터에서 같은 아이디로 로그인하면 같은 내용을 내려받는다.
// 비밀번호는 컴퓨터에 저장하지 않고, 로그인 후 받은 "로그인 유지 토큰"만 저장한다.
const Sync = (() => {
  const C = window.FIREBASE_CONFIG || {};
  const configured = !!(C.apiKey && C.projectId);
  const DOMAIN = '@desktop-calendar.app';   // 아이디를 Firebase 가 요구하는 이메일 형태로 바꿀 때 붙이는 꼬리
  let auth = load('syncAuth', null);        // { id, uid, refreshToken }
  let idToken = null, idTokenExp = 0;
  let lastSync = load('syncLast', 0);
  let pushTimer = null, busy = false;
  const listeners = [];
  let status = '';

  const emit = (msg) => { if (msg !== undefined) status = msg; listeners.forEach(f => f()); };
  const ERR = {
    EMAIL_EXISTS: '이미 있는 아이디입니다. 로그인을 눌러주세요.',
    EMAIL_NOT_FOUND: '없는 아이디입니다. 처음이면 "새로 가입"을 눌러주세요.',
    INVALID_PASSWORD: '비밀번호가 틀렸습니다.',
    INVALID_LOGIN_CREDENTIALS: '아이디 또는 비밀번호가 틀렸습니다.',
    WEAK_PASSWORD: '비밀번호는 6자 이상이어야 합니다.',
    TOO_MANY_ATTEMPTS_TRY_LATER: '시도가 너무 많습니다. 잠시 후 다시 해주세요.',
    INVALID_EMAIL: '아이디는 영문, 숫자, . _ - 만 쓸 수 있습니다.',
    OPERATION_NOT_ALLOWED: 'Firebase 에서 이메일/비밀번호 로그인이 켜져 있지 않습니다.',
  };
  const niceError = (e) => {
    const code = String(e && e.message || e).split(' ')[0];
    return ERR[code] || `연동 오류: ${String(e && e.message || e).slice(0, 80)}`;
  };

  async function call(url, body, form) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body) : JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j.error && j.error.message) || res.status);
    return j;
  }

  async function login(id, pw, isNew) {
    id = id.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(id)) throw new Error('INVALID_EMAIL');
    const ep = isNew ? 'signUp' : 'signInWithPassword';
    const j = await call(`https://identitytoolkit.googleapis.com/v1/accounts:${ep}?key=${C.apiKey}`,
                         { email: id + DOMAIN, password: pw, returnSecureToken: true });
    auth = { id, uid: j.localId, refreshToken: j.refreshToken };
    idToken = j.idToken; idTokenExp = Date.now() + (Number(j.expiresIn) - 60) * 1000;
    save('syncAuth', auth);
  }

  async function token() {
    if (idToken && Date.now() < idTokenExp) return idToken;
    const j = await call(`https://securetoken.googleapis.com/v1/token?key=${C.apiKey}`,
                         { grant_type: 'refresh_token', refresh_token: auth.refreshToken }, true);
    idToken = j.id_token; idTokenExp = Date.now() + (Number(j.expires_in) - 60) * 1000;
    if (j.refresh_token && j.refresh_token !== auth.refreshToken) { auth.refreshToken = j.refresh_token; save('syncAuth', auth); }
    return idToken;
  }

  const docUrl = () => `https://firestore.googleapis.com/v1/projects/${C.projectId}/databases/(default)/documents/calendars/${auth.uid}`;

  async function getRemote() {
    const res = await fetch(docUrl(), { headers: { Authorization: 'Bearer ' + await token() } });
    if (res.status === 404) return { events: [], memos: [] };
    if (!res.ok) throw new Error('불러오기 실패 ' + res.status);
    const j = await res.json();
    try { return JSON.parse(j.fields.data.stringValue); } catch { return { events: [], memos: [] }; }
  }

  async function putRemote(data) {
    const res = await fetch(docUrl(), {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { data: { stringValue: JSON.stringify(data) }, updatedAt: { integerValue: String(Date.now()) } } }),
    });
    if (!res.ok) throw new Error('저장 실패 ' + res.status);
  }

  // 같은 id 는 더 나중에 바뀐 쪽(u 가 큰 쪽)을 남긴다. 순서는 내 쪽 순서를 유지하고 새 항목은 뒤에 붙인다.
  function merge(mine, theirs) {
    const map = new Map(mine.map(x => [x.id, x]));
    const order = mine.map(x => x.id);
    for (const t of theirs) {
      const m = map.get(t.id);
      if (!m) { map.set(t.id, t); order.push(t.id); }
      else if ((t.u || 0) > (m.u || 0)) map.set(t.id, t);
    }
    return order.map(id => map.get(id));
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // 내려받기 + 합치기 + 올리기를 한 번에
  async function syncNow() {
    if (!configured || !auth || busy) return;
    busy = true; emit('동기화 중...');
    try {
      const remote = await getRemote();
      const localEvents = load('events2', []), localMemos = load('memos', []);
      // 받아오는 동안 이 컴퓨터에서 바뀐 것도 놓치지 않도록 지금 값과 한 번 더 합친다
      const events = merge(load('events2', []), merge(localEvents, remote.events || []));
      const memos = merge(load('memos', []), merge(localMemos, remote.memos || []));
      if (!same(events, localEvents)) { save('events2', events); Sync.onLocalChanged && Sync.onLocalChanged(); }
      if (!same(memos, localMemos)) save('memos', memos);   // 메모 창은 storage 이벤트로 알아서 다시 그린다
      if (!same(events, remote.events || []) || !same(memos, remote.memos || [])) await putRemote({ events, memos });
      lastSync = Date.now(); save('syncLast', lastSync);
      emit('');
    } catch (e) {
      if (/TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_NOT_FOUND|USER_DISABLED/.test(String(e.message))) { logout(); emit('다시 로그인해 주세요.'); }
      else emit(navigator.onLine ? niceError(e) : '인터넷 연결이 없어 연동을 잠시 멈췄습니다.');
    } finally { busy = false; }
  }

  // 내용이 바뀌면 2초 뒤에 올린다 (연속으로 고칠 때 한 번만 올리도록)
  function schedulePush() {
    if (!configured || !auth) return;
    clearTimeout(pushTimer); pushTimer = setTimeout(syncNow, 2000);
  }

  function logout() { auth = null; idToken = null; localStorage.removeItem('syncAuth'); emit(''); }

  // 다른 창(메모 창)에서 메모를 바꾸면 올리기
  window.addEventListener('storage', e => { if (e.key === 'memos') schedulePush(); });
  setInterval(syncNow, 60 * 1000);           // 1분마다 다른 컴퓨터의 변경 확인
  window.addEventListener('online', syncNow);
  setTimeout(syncNow, 1500);

  return {
    configured,
    get auth() { return auth; },
    get status() { return status; },
    get lastSync() { return lastSync; },
    onChange: f => listeners.push(f),
    onLocalChanged: null,
    schedulePush, syncNow,
    async login(id, pw, isNew) {
      try { emit(isNew ? '가입 중...' : '로그인 중...'); await login(id, pw, isNew); emit(''); await syncNow(); return true; }
      catch (e) { emit(niceError(e)); return false; }
    },
    logout,
  };
})();
