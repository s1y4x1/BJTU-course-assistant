(function captureSsoLogin() {
  'use strict';
  if (globalThis.__bjtuSsoLoginCapture || typeof globalThis.doLogin !== 'function') return;
  globalThis.__bjtuSsoLoginCapture = true;
  const original = globalThis.doLogin;
  globalThis.doLogin = function (...args) {
    const params = args[0];
    const capture = params?.type === 'username_password' && !params.skipEncrypt && globalThis.firstLogin !== false;
    const loginName = capture ? String(params.username || '').trim() : '';
    const password = capture ? String(params.password || '') : '';
    const result = Reflect.apply(original, this, args);
    if (loginName && password) {
      window.dispatchEvent(new CustomEvent('bjtuca-sso-login-credentials', {
        detail: {
          loginName, password,
          requestPassword: String(params.password || ''),
          flowId: document.querySelector('#loginForm input[name="flowId"]')?.value || ''
        }
      }));
    }
    return result;
  };
})();
