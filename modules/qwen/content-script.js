/* 通义千问页面桥接：同步登录令牌。 */
(function initQwenLoginTokenBridge() {
  'use strict';

  const SESSION_KEY_CANDIDATES = ['token', 'access_token', 'qwen_token', 'jwt_token'];
  let lastSent = null;

  function readToken() {
    for (const key of SESSION_KEY_CANDIDATES) {
      const value = String(localStorage.getItem(key) || '').trim();
      if (value) return value;
    }
    return '';
  }

  function sendToBackground(message) {
    try {
      chrome.runtime.sendMessage(message, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // 页面正在关闭时无需处理。
    }
  }

  function sendToken(token) {
    const value = String(token || '').trim();
    if (value === lastSent) return;
    lastSent = value;
    sendToBackground(value
      ? { type: 'QWEN_TOKEN_CAPTURED', payload: { token: value } }
      : { type: 'QWEN_TOKEN_CLEARED' });
  }

  function check() {
    sendToken(readToken());
  }

  check();
  window.addEventListener('pageshow', check);
  window.addEventListener('storage', check);
  setInterval(check, location.pathname.startsWith('/auth') ? 500 : 8000);
})();
