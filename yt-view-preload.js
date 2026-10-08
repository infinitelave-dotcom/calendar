// 유튜브 화면(구글 로그인 포함)이 열리기 직전에 실행된다.
// 일반 파이어폭스에는 없는 크롬 전용 표시를 감춰서, 구글이 "앱 안의 브라우저"로 보고 로그인을 막지 않게 한다.
const { webFrame } = require('electron');
webFrame.executeJavaScript(`(() => {
  try { Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true }); } catch (e) {}
  try { Object.defineProperty(Navigator.prototype, 'vendor', { get: () => '', configurable: true }); } catch (e) {}
  try { delete window.chrome; } catch (e) {}
})()`);
