(function detectBjtuVeLoginResponse() {
  'use strict';

  const NETWORK_MESSAGE_TYPE = '__BJTU_VE_LOGIN_NETWORK_RESPONSE__';
  let isLoginResponseDocument = false;
  try {
    const url = new URL(location.href);
    if (url.hostname !== '123.121.147.7' || url.port !== '88' || !/^\/ve(?:\/|$)/i.test(url.pathname)) return;
    isLoginResponseDocument = /^\/ve\/s\.shtml$/i.test(url.pathname);
  } catch {
    return;
  }

  let sent = false;
  let timer = null;
  let observer = null;
  let responsePort = null;
  if (isLoginResponseDocument) {
    try {
      responsePort = chrome.runtime.connect({ name: 'bjtu-ve-login-response' });
    } catch {
      responsePort = null;
    }
  }

  const report = (payload) => {
    try {
      if (responsePort) responsePort.postMessage(payload);
      else void chrome.runtime.sendMessage({ type: 'PORTAL_LOGIN_RESPONSE', payload }).catch(() => {});
    } catch {
      // The extension may be reloaded while the page is being navigated.
    }
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== NETWORK_MESSAGE_TYPE) return;
    report({
      html: String(event.data?.payload?.html || ''),
      url: String(event.data?.payload?.url || ''),
      activeSuccessScript: event.data?.payload?.activeSuccessScript === true
    });
  });

  if (!isLoginResponseDocument) return;

  const sendResponse = () => {
    if (sent) return;
    const html = String(document.documentElement?.outerHTML || document.documentElement?.innerHTML || '');
    if (!html) return;

    // The login response is an inline-script page. Polling lets us observe the
    // script while the parser is still running, before its location redirect.
    const activeSuccessScript = [...document.scripts].some((script) => (
      /location\.href\s*=\s*['"]http:\/\/123\.121\.147\.7:88\/ve\/back\/core\/main\/index\.shtml\?method=index&type=qxkt['"]/i
        .test(String(script.textContent || ''))
    ));
    const hasSuccessMarker = activeSuccessScript || (html.includes('史家跳转首页')
      && /location\.href\s*=\s*['"]http:\/\/123\.121\.147\.7:88\/ve\/back\/core\/main\/index\.shtml\?method=index&type=qxkt['"]/i.test(html));
    const hasFailureMarker = /账号或密码错误|错误次数过多|请输入正确的验证码|默认密码|系统发生了未处理的异常|alert\s*\(/i.test(html);
    if (!hasSuccessMarker && !hasFailureMarker && document.readyState === 'loading') return;

    sent = true;
    if (timer) clearInterval(timer);
    observer?.disconnect();
    report({ html, url: location.href, activeSuccessScript });
  };

  observer = new MutationObserver(sendResponse);
  observer.observe(document, { childList: true, subtree: true, characterData: true });
  timer = setInterval(sendResponse, 25);
  window.addEventListener('beforeunload', sendResponse, { capture: true, once: true });
  window.addEventListener('pagehide', sendResponse, { capture: true, once: true });
  document.addEventListener('DOMContentLoaded', () => setTimeout(sendResponse, 0), { once: true });
  window.addEventListener('load', () => setTimeout(sendResponse, 0), { once: true });
  setTimeout(() => {
    if (timer) clearInterval(timer);
    sendResponse();
  }, 1500);
})();
