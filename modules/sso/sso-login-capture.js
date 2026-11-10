(function relaySsoLogin() {
  'use strict';
  window.addEventListener('bjtuca-sso-login-credentials', (event) => {
    const data = event.detail;
    if (!data || typeof data.loginName !== 'string' || typeof data.password !== 'string'
        || typeof data.requestPassword !== 'string' || typeof data.flowId !== 'string') return;
    void chrome.runtime.sendMessage({ type: 'CAS_CAPTURE_SSO_CREDENTIALS', payload: data }).catch(() => {});
  });
})();
